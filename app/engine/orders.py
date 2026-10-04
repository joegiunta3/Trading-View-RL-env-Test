"""Order validation, placement and per-second matching. Full fills only, Day TIF."""

import sqlite3
from dataclasses import dataclass

from app.config import DUPLICATE_ORDER_WINDOW_SEC, SESSION_SECONDS
from app.engine import account
from app.engine.errors import EngineError
from app.market import MarketData
from app.timeline import fmt_ts, second_of_day
from app.timeutil import cents_to_usd

SIDES = ("buy", "sell", "short", "cover")
TYPES = ("market", "limit", "stop")
PAYS_ASK = ("buy", "cover")  # buy-like sides fill at the ask and their stops trigger on a rise


@dataclass(frozen=True)
class OrderRequest:
    symbol_id: int
    ticker: str
    side: str
    type: str
    qty: int
    limit_price: int | None = None  # cents
    stop_price: int | None = None


class Rejection(Exception):
    pass


def _fill_price(market: MarketData, sid: int, side: str, s: int) -> int:
    bid, ask = market.bid_ask(sid, s)
    return ask if side in PAYS_ASK else bid


def _working_qty(conn: sqlite3.Connection, sid: int, side: str, exclude: int | None) -> int:
    return conn.execute(
        "SELECT COALESCE(SUM(qty), 0) FROM orders WHERE status = 'working' AND symbol_id = ? "
        "AND side = ? AND id IS NOT ?",
        (sid, side, exclude),
    ).fetchone()[0]


def check_position_rules(
    conn: sqlite3.Connection, sid: int, ticker: str, side: str, qty: int, exclude: int | None
) -> None:
    pos, _ = account.position(conn, sid)
    if side == "buy" and pos < 0:
        raise Rejection(f"You are short {ticker}. Use Cover to close a short position.")
    if side == "short" and pos > 0:
        raise Rejection(f"You hold a long position in {ticker}. Sell it before shorting.")
    if side in ("sell", "cover"):
        held = max(pos, 0) if side == "sell" else max(-pos, 0)
        available = held - _working_qty(conn, sid, side, exclude)
        if qty > available:
            what = "sell" if side == "sell" else "cover"
            raise Rejection(
                f"Cannot {what} {qty} {ticker}: only {max(available, 0)} shares available to {what}."
            )


def _check_buying_power(conn: sqlite3.Connection, need: int, exclude: int | None) -> None:
    bp = account.buying_power(conn, exclude)
    if need > bp:
        raise Rejection(
            f"Insufficient buying power: order needs ${cents_to_usd(need):,.2f}, "
            f"available ${cents_to_usd(max(bp, 0)):,.2f}."
        )


def _validate_new(conn: sqlite3.Connection, market: MarketData, t: int, req: OrderRequest) -> None:
    if req.side not in SIDES:
        raise Rejection(f"Unknown side {req.side!r}.")
    if req.type not in TYPES:
        raise Rejection(f"Unknown order type {req.type!r}.")
    if req.qty <= 0:
        raise Rejection("Quantity must be a positive whole number.")
    if req.type == "limit" and (req.limit_price is None or req.limit_price <= 0):
        raise Rejection("Limit orders need a limit price above $0.")
    if req.type == "stop" and (req.stop_price is None or req.stop_price <= 0):
        raise Rejection("Stop orders need a stop price above $0.")
    last = market.price(req.symbol_id, t)
    if req.type == "stop":
        if req.side in PAYS_ASK and req.stop_price <= last:
            raise Rejection(
                f"A {req.side} stop must be above the last price (${cents_to_usd(last):.2f})."
            )
        if req.side not in PAYS_ASK and req.stop_price >= last:
            raise Rejection(
                f"A {req.side} stop must be below the last price (${cents_to_usd(last):.2f})."
            )
    dup = conn.execute(
        "SELECT 1 FROM orders WHERE status != 'rejected' AND symbol_id = ? AND side = ? AND type = ? "
        "AND qty = ? AND limit_price IS ? AND stop_price IS ? AND created_sim_ts >= ?",
        (
            req.symbol_id,
            req.side,
            req.type,
            req.qty,
            req.limit_price,
            req.stop_price,
            t - DUPLICATE_ORDER_WINDOW_SEC,
        ),
    ).fetchone()
    if dup:
        raise Rejection(
            "Duplicate order: an identical order was submitted less than "
            f"{DUPLICATE_ORDER_WINDOW_SEC} seconds ago. Please wait before resubmitting."
        )
    check_position_rules(conn, req.symbol_id, req.ticker, req.side, req.qty, None)
    if req.side in ("buy", "short"):
        if req.type == "market":
            ref = _fill_price(market, req.symbol_id, req.side, t)
        else:
            ref = req.limit_price if req.type == "limit" else req.stop_price
        _check_buying_power(conn, req.qty * ref, None)


def get_order(conn: sqlite3.Connection, order_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()


def submit(
    conn: sqlite3.Connection, market: MarketData, t: int, req: OrderRequest
) -> tuple[dict, list[dict]]:
    """Validate and record an order; market and marketable limit orders fill at t.

    Returns (order view, engine events).
    """
    limit_p = req.limit_price if req.type == "limit" else None
    stop_p = req.stop_price if req.type == "stop" else None
    req = OrderRequest(req.symbol_id, req.ticker, req.side, req.type, req.qty, limit_p, stop_p)
    try:
        _validate_new(conn, market, t, req)
        status, reason = "working", None
    except Rejection as e:
        status, reason = "rejected", str(e)
    cur = conn.execute(
        "INSERT INTO orders (symbol_id, side, type, qty, limit_price, stop_price, status, "
        "created_sim_ts, closed_sim_ts, reason) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            req.symbol_id,
            req.side,
            req.type,
            req.qty,
            limit_p,
            stop_p,
            status,
            t,
            t if status == "rejected" else None,
            reason,
        ),
    )
    order = get_order(conn, cur.lastrowid)
    events: list[dict] = []
    if status == "working":
        if req.type == "market" or (req.type == "limit" and _limit_marketable(market, order, t)):
            events.append(fill(conn, market, order, t))
    return order_view(conn, get_order(conn, order["id"])), events


def _limit_marketable(market: MarketData, order: sqlite3.Row, s: int) -> bool:
    bid, ask = market.bid_ask(order["symbol_id"], s)
    if order["side"] in PAYS_ASK:
        return ask <= order["limit_price"]
    return bid >= order["limit_price"]


def _stop_triggered(market: MarketData, order: sqlite3.Row, s: int) -> bool:
    p = market.price(order["symbol_id"], s)
    if order["side"] in PAYS_ASK:
        return p >= order["stop_price"]
    return p <= order["stop_price"]


def fill(conn: sqlite3.Connection, market: MarketData, order: sqlite3.Row, s: int) -> dict:
    """Fill `order` in full at the quote of second s, re-checking rules at fill time."""
    sid, side, qty = order["symbol_id"], order["side"], order["qty"]
    ticker = market.world.symbols[sid - 1].ticker
    price = _fill_price(market, sid, side, s)
    try:
        check_position_rules(conn, sid, ticker, side, qty, order["id"])
        if side in ("buy", "short"):
            _check_buying_power(conn, qty * price, order["id"])
    except Rejection as e:
        conn.execute(
            "UPDATE orders SET status = 'rejected', closed_sim_ts = ?, reason = ? WHERE id = ?",
            (s, f"Rejected at fill: {e}", order["id"]),
        )
        return {"type": "order_rejected", "order_id": order["id"], "sim_ts": s, "reason": str(e)}
    realized = account.apply_fill(conn, sid, side, qty, price)
    conn.execute(
        "UPDATE orders SET status = 'filled', filled_sim_ts = ?, fill_price = ?, closed_sim_ts = ? "
        "WHERE id = ?",
        (s, price, s, order["id"]),
    )
    conn.execute(
        "INSERT INTO trades (order_id, symbol_id, side, qty, price, realized_pnl, sim_ts) "
        "VALUES (?,?,?,?,?,?,?)",
        (order["id"], sid, side, qty, price, realized, s),
    )
    return {
        "type": "order_filled",
        "order_id": order["id"],
        "ticker": ticker,
        "side": side,
        "qty": qty,
        "price": cents_to_usd(price),
        "sim_ts": s,
    }


def working_orders(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM orders WHERE status = 'working' ORDER BY id").fetchall()


def process_second(conn: sqlite3.Connection, market: MarketData, s: int) -> list[dict]:
    """Match resting orders against second s. Order: due stop fills, new stop triggers, limits."""
    events: list[dict] = []
    rows = working_orders(conn)
    last_second = second_of_day(s) == SESSION_SECONDS - 1  # a stop can't wait for the next day
    for o in rows:
        if o["type"] == "stop" and o["triggered_sim_ts"] is not None and o["triggered_sim_ts"] < s:
            events.append(fill(conn, market, o, s))
    for o in rows:
        if o["type"] == "stop" and o["triggered_sim_ts"] is None and o["created_sim_ts"] < s:
            if _stop_triggered(market, o, s):
                conn.execute("UPDATE orders SET triggered_sim_ts = ? WHERE id = ?", (s, o["id"]))
                events.append({"type": "stop_triggered", "order_id": o["id"], "sim_ts": s})
                if last_second:
                    events.append(fill(conn, market, get_order(conn, o["id"]), s))
    for o in rows:
        if o["type"] == "limit" and o["created_sim_ts"] < s:
            current = get_order(conn, o["id"])
            if current["status"] == "working" and _limit_marketable(market, current, s):
                events.append(fill(conn, market, current, s))
    return events


def cancel(conn: sqlite3.Connection, order_id: int, t: int) -> dict:
    order = get_order(conn, order_id)
    if order is None:
        raise EngineError(f"Order {order_id} not found.", 404)
    if order["status"] != "working":
        raise EngineError(f"Order {order_id} is {order['status']} and cannot be cancelled.", 409)
    conn.execute(
        "UPDATE orders SET status = 'cancelled', closed_sim_ts = ?, reason = 'Cancelled by user' "
        "WHERE id = ?",
        (t, order_id),
    )
    return order_view(conn, get_order(conn, order_id))


def cancel_all_working(conn: sqlite3.Connection, t: int, reason: str) -> list[int]:
    ids = [r["id"] for r in working_orders(conn)]
    conn.execute(
        "UPDATE orders SET status = 'cancelled', closed_sim_ts = ?, reason = ? WHERE status = 'working'",
        (t, reason),
    )
    return ids


def _usd(c: int | None) -> float | None:
    return None if c is None else cents_to_usd(c)


def order_view(conn: sqlite3.Connection, o: sqlite3.Row) -> dict:
    ticker = conn.execute("SELECT ticker FROM symbols WHERE id = ?", (o["symbol_id"],)).fetchone()[
        0
    ]
    return {
        "id": o["id"],
        "ticker": ticker,
        "side": o["side"],
        "type": o["type"],
        "qty": o["qty"],
        "limit_price": _usd(o["limit_price"]),
        "stop_price": _usd(o["stop_price"]),
        "status": o["status"],
        "created_sim_ts": o["created_sim_ts"],
        "triggered_sim_ts": o["triggered_sim_ts"],
        "filled_sim_ts": o["filled_sim_ts"],
        "fill_price": _usd(o["fill_price"]),
        "closed_sim_ts": o["closed_sim_ts"],
        "created_time": fmt_ts(o["created_sim_ts"]),
        "triggered_time": fmt_ts(o["triggered_sim_ts"]),
        "filled_time": fmt_ts(o["filled_sim_ts"]),
        "closed_time": fmt_ts(o["closed_sim_ts"]),
        "reason": o["reason"],
        "time_in_force": "day",
    }
