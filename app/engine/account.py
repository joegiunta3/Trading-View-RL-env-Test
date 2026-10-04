"""Cash, positions, buying power and fills. Cash-secured shorts: short proceeds are not
credited to cash; the entry notional is locked as collateral until covered."""

import sqlite3

from app.market import MarketData
from app.timeutil import cents_to_usd

RESERVING_SIDES = ("buy", "short")


def get_account(conn: sqlite3.Connection) -> sqlite3.Row:
    return conn.execute("SELECT * FROM account WHERE id = 1").fetchone()


def position(conn: sqlite3.Connection, sid: int) -> tuple[int, int]:
    row = conn.execute(
        "SELECT qty, cost_basis FROM positions WHERE symbol_id = ?", (sid,)
    ).fetchone()
    return (row["qty"], row["cost_basis"]) if row else (0, 0)


def short_collateral(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(cost_basis), 0) FROM positions WHERE qty < 0"
    ).fetchone()
    return row[0]


def reserved(conn: sqlite3.Connection, exclude_order_id: int | None = None) -> int:
    """Cash held back for working buy/short orders, at their limit or stop price."""
    row = conn.execute(
        "SELECT COALESCE(SUM(qty * COALESCE(limit_price, stop_price)), 0) FROM orders "
        "WHERE status = 'working' AND side IN ('buy', 'short') AND id IS NOT ?",
        (exclude_order_id,),
    ).fetchone()
    return row[0]


def buying_power(conn: sqlite3.Connection, exclude_order_id: int | None = None) -> int:
    cash = get_account(conn)["cash"]
    return cash - reserved(conn, exclude_order_id) - short_collateral(conn)


def set_position(conn: sqlite3.Connection, sid: int, qty: int, cost_basis: int) -> None:
    if qty == 0:
        conn.execute("DELETE FROM positions WHERE symbol_id = ?", (sid,))
        return
    avg = round(cost_basis / abs(qty) / 100, 6)
    conn.execute(
        "INSERT INTO positions (symbol_id, qty, avg_price, cost_basis) VALUES (?,?,?,?) "
        "ON CONFLICT(symbol_id) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, "
        "cost_basis=excluded.cost_basis",
        (sid, qty, avg, cost_basis),
    )


def apply_fill(conn: sqlite3.Connection, sid: int, side: str, qty: int, price: int) -> int:
    """Update cash and position for a fill; returns realized P&L in cents."""
    pos, cost = position(conn, sid)
    notional = qty * price
    cash_delta = realized = 0
    if side == "buy":
        cash_delta = -notional
        pos, cost = pos + qty, cost + notional
    elif side == "short":
        pos, cost = pos - qty, cost + notional
    else:
        held = abs(pos)
        removed = cost if qty == held else cost * qty // held
        if side == "sell":
            cash_delta = notional
            realized = notional - removed
            pos -= qty
        else:  # cover
            realized = removed - notional
            cash_delta = realized
            pos += qty
        cost -= removed
    set_position(conn, sid, pos, cost)
    conn.execute(
        "UPDATE account SET cash = cash + ?, realized_pnl = realized_pnl + ? WHERE id = 1",
        (cash_delta, realized),
    )
    return realized


def positions_view(conn: sqlite3.Connection, market: MarketData, t: int) -> list[dict]:
    out = []
    rows = conn.execute(
        "SELECT p.*, s.ticker FROM positions p JOIN symbols s ON s.id = p.symbol_id ORDER BY s.id"
    )
    for r in rows:
        last = market.price(r["symbol_id"], t)
        qty, cost = r["qty"], r["cost_basis"]
        mv = qty * last
        unreal = mv - cost if qty > 0 else cost - abs(qty) * last
        out.append(
            {
                "ticker": r["ticker"],
                "qty": qty,
                "side": "long" if qty > 0 else "short",
                "avg_price": r["avg_price"],
                "last": cents_to_usd(last),
                "market_value": cents_to_usd(mv),
                "unrealized_pnl": cents_to_usd(unreal),
                "_unreal_cents": unreal,
                "_mv_cents": mv,
            }
        )
    return out


def summary(conn: sqlite3.Connection, market: MarketData, t: int) -> dict:
    acct = get_account(conn)
    pos = positions_view(conn, market, t)
    long_mv = sum(p["_mv_cents"] for p in pos if p["qty"] > 0)
    short_unreal = sum(p["_unreal_cents"] for p in pos if p["qty"] < 0)
    unreal = sum(p["_unreal_cents"] for p in pos)
    equity = acct["cash"] + long_mv + short_unreal
    return {
        "cash": cents_to_usd(acct["cash"]),
        "start_cash": cents_to_usd(acct["start_cash"]),
        "buying_power": cents_to_usd(buying_power(conn)),
        "reserved_for_orders": cents_to_usd(reserved(conn)),
        "short_collateral": cents_to_usd(short_collateral(conn)),
        "long_market_value": cents_to_usd(long_mv),
        "equity": cents_to_usd(equity),
        "realized_pnl": cents_to_usd(acct["realized_pnl"]),
        "unrealized_pnl": cents_to_usd(unreal),
        "total_pnl": cents_to_usd(acct["realized_pnl"] + unreal),
    }


def public_positions(conn: sqlite3.Connection, market: MarketData, t: int) -> list[dict]:
    return [
        {k: v for k, v in p.items() if not k.startswith("_")}
        for p in positions_view(conn, market, t)
    ]
