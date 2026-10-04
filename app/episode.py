"""Episode: one reset world + DB + clock + engine. All public/env operations go through here.

Every operation first calls sync(), which processes each elapsed sim second in order, so
outcomes depend only on sim timing and never on how often the server loop runs.
"""

import functools
import json
import secrets
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from app.clock import ClockError, ClockMode, ClockState, SimClock
from app.config import SESSION_DATE, SESSION_SECONDS, START_CASH_CENTS
from app.db import new_episode_db, state_hash
from app.engine import account, alerts, orders
from app.engine.errors import EngineError
from app.market import TIMEFRAMES, MarketData, market_for_seed
from app.timeutil import cents_to_usd, fmt_hhmmss, parse_hhmm, usd_to_cents
from app.world.generate import build_world
from app.world.truth import write_truth

DEFAULT_PREFS = {"timeframe": "5m", "indicators": [{"type": "volume"}]}
MAX_SMA_PERIOD = 500
MAX_INDICATORS = 10
MAX_NAME_LEN = 40
MAX_NOTE_LEN = 200


def _locked(method: Callable) -> Callable:
    """Serialize access: one sqlite connection is shared by request threads and the ticker."""

    @functools.wraps(method)
    def wrapper(self: "Episode", *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)

    return wrapper


def _cents(usd: float | None, field: str) -> int | None:
    if usd is None:
        return None
    try:
        return usd_to_cents(usd)
    except (ValueError, TypeError) as e:
        raise EngineError(f"{field}: {e}", 422) from e


class Episode:
    def __init__(
        self,
        seed: int,
        start_time: str = "09:00",
        clock_mode: str = "realtime",
        setup: dict | None = None,
        db_path: str | Path = ":memory:",
        truth_dir: Path | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ):
        try:
            start_sec = parse_hhmm(start_time)
            self.clock = SimClock(ClockMode(clock_mode), start_sec, monotonic)
        except (ValueError, ClockError) as e:
            raise EngineError(str(e), 422) from e
        self.episode_id = secrets.token_hex(8)
        self.seed = seed
        self.world = build_world(seed)
        self.market: MarketData = market_for_seed(seed)
        self.conn: sqlite3.Connection = new_episode_db(seed, db_path)
        self.conn.execute("PRAGMA synchronous = OFF")
        self.lock = threading.RLock()
        self._wall = wall_clock
        self._events: list[dict] = []
        self._last_processed = start_sec
        self._close_handled = False
        with self._tx():
            self._init_state(setup or {})
        if truth_dir is not None:
            write_truth(self.world, truth_dir / self.episode_id)

    # --- infrastructure -----------------------------------------------------------------

    @contextmanager
    def _tx(self) -> Iterator[None]:
        with self.lock:
            if self.conn.in_transaction:
                yield
                return
            self.conn.execute("BEGIN")
            try:
                yield
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def _log(self, endpoint: str, payload: dict, sim_ts: int | None = None) -> None:
        self.conn.execute(
            "INSERT INTO action_log (wall_ts, sim_ts, endpoint, payload) VALUES (?,?,?,?)",
            (
                self._wall(),
                self.clock.now if sim_ts is None else sim_ts,
                endpoint,
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
            ),
        )

    def _emit(self, event: dict) -> None:
        self._events.append({"seq": len(self._events) + 1, **event})

    def _init_state(self, setup: dict) -> None:
        cash = _cents(setup.get("cash"), "cash") if "cash" in setup else START_CASH_CENTS
        self.conn.execute(
            "INSERT INTO account (id, cash, start_cash, realized_pnl) VALUES (1, ?, ?, 0)",
            (cash, cash),
        )
        for p in setup.get("positions", []):
            sid = self._sid(p["ticker"])
            qty = int(p["qty"])
            if qty == 0:
                raise EngineError("setup position qty must be non-zero", 422)
            cost = abs(qty) * _cents(p["avg_price"], "avg_price")
            account.set_position(self.conn, sid, qty, cost)
        cur = self.conn.execute("INSERT INTO watchlists (name) VALUES ('Watchlist')")
        for i, t in enumerate(self.world.default_watchlist):
            self.conn.execute(
                "INSERT INTO watchlist_items VALUES (?,?,?)", (cur.lastrowid, self._sid(t), i)
            )
        self.conn.execute(
            "INSERT INTO ui_state VALUES ('active_symbol', ?)", (self.world.default_watchlist[0],)
        )

    def _sid(self, ticker: str) -> int:
        sym = self.world.by_ticker.get(str(ticker).strip().upper())
        if sym is None:
            raise EngineError(f"Unknown symbol {ticker!r}.", 404)
        return sym.id

    def _ticker(self, sid: int) -> str:
        return self.world.symbols[sid - 1].ticker

    def _require_trading(self) -> None:
        state = self.clock.state
        if state is ClockState.READY:
            raise EngineError("The market is not open yet.", 409)
        if state is ClockState.CLOSED:
            raise EngineError("Session closed. Trading has ended for the day.", 409)

    def _require_not_closed(self) -> None:
        if self.clock.state is ClockState.CLOSED:
            raise EngineError("Session closed.", 409)

    # --- clock and event processing -------------------------------------------------------

    @property
    def now(self) -> int:
        return self.clock.now

    @_locked
    def sync(self) -> int:
        """Process every elapsed sim second up to now; handle the close. Returns sim_now."""
        with self._tx():
            now = self.clock.now
            if self.clock.state is ClockState.READY:
                return now
            end = min(now, SESSION_SECONDS - 1)
            if end > self._last_processed:
                self._process_range(self._last_processed + 1, end)
                self._last_processed = end
            if now >= SESSION_SECONDS and not self._close_handled:
                self._close_handled = True
                ids = orders.cancel_all_working(
                    self.conn, SESSION_SECONDS, "Day order expired at close"
                )
                for oid in ids:
                    self._log("engine:expire", {"order_id": oid}, SESSION_SECONDS)
                    self._emit(
                        {"type": "order_cancelled", "order_id": oid, "sim_ts": SESSION_SECONDS}
                    )
                self._log("engine:session_closed", {}, SESSION_SECONDS)
                self._emit({"type": "session_closed", "sim_ts": SESSION_SECONDS})
            return now

    def _process_range(self, a: int, b: int) -> None:
        has_orders = bool(orders.working_orders(self.conn))
        has_alerts = bool(alerts.active(self.conn))
        if not (has_orders or has_alerts):
            return
        for s in range(a, b + 1):
            evs: list[dict] = []
            if has_orders:
                evs += orders.process_second(self.conn, self.market, s)
            if has_alerts:
                evs += alerts.process_second(self.conn, self.market, s)
            if evs:
                for e in evs:
                    self._log(f"engine:{e['type']}", e, s)
                    self._emit(e)
                has_orders = bool(orders.working_orders(self.conn))
                has_alerts = bool(alerts.active(self.conn))
                if not (has_orders or has_alerts):
                    return

    @_locked
    def start(self) -> dict:
        with self._tx():
            try:
                self.clock.start()
            except ClockError as e:
                raise EngineError(str(e), 409) from e
            self._log("env:start", {})
            return self.clock_view()

    @_locked
    def advance(self, sim_seconds: int) -> dict:
        with self._tx():
            try:
                self.clock.advance(sim_seconds)
            except ClockError as e:
                raise EngineError(str(e), 409) from e
            self.sync()
            return self.clock_view()

    @_locked
    def clock_view(self) -> dict:
        now = self.sync()
        state = self.clock.state
        status = {"ready": "pre-open", "running": "open", "closed": "closed"}[state.value]
        return {
            "sim_now": now,
            "time": fmt_hhmmss(now),
            "date": SESSION_DATE,
            "market_status": status,
            "session_open": "09:00:00",
            "session_close": "16:30:00",
        }

    @_locked
    def events_since(self, seq: int) -> list[dict]:
        with self.lock:
            return self._events[seq:]

    # --- market views ----------------------------------------------------------------------

    @_locked
    def symbols(self) -> list[dict]:
        return [
            {"ticker": s.ticker, "name": s.name, "sector": s.sector} for s in self.world.symbols
        ]

    @_locked
    def quotes(self) -> list[dict]:
        t = self.sync()
        return [self.market.quote(s.id, t) for s in self.world.symbols]

    @_locked
    def quote(self, ticker: str) -> dict:
        t = self.sync()
        return self.market.quote(self._sid(ticker), t)

    @_locked
    def bars(self, ticker: str, tf: str, last: int | None = None) -> list[dict]:
        t = self.sync()
        if tf not in TIMEFRAMES:
            raise EngineError(f"Unknown timeframe {tf!r}. Use one of {', '.join(TIMEFRAMES)}.", 422)
        return self.market.bars(self._sid(ticker), tf, t, last)

    # --- trading ---------------------------------------------------------------------------

    @_locked
    def account_summary(self) -> dict:
        t = self.sync()
        return account.summary(self.conn, self.market, t)

    @_locked
    def positions(self) -> list[dict]:
        t = self.sync()
        return account.public_positions(self.conn, self.market, t)

    @_locked
    def list_orders(self) -> list[dict]:
        self.sync()
        rows = self.conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
        return [orders.order_view(self.conn, r) for r in rows]

    @_locked
    def trades(self) -> list[dict]:
        self.sync()
        rows = self.conn.execute(
            "SELECT t.*, s.ticker FROM trades t JOIN symbols s ON s.id = t.symbol_id ORDER BY t.id DESC"
        )
        return [
            {
                "id": r["id"],
                "order_id": r["order_id"],
                "ticker": r["ticker"],
                "side": r["side"],
                "qty": r["qty"],
                "price": cents_to_usd(r["price"]),
                "realized_pnl": cents_to_usd(r["realized_pnl"]),
                "sim_ts": r["sim_ts"],
                "time": fmt_hhmmss(r["sim_ts"]),
            }
            for r in rows
        ]

    @_locked
    def place_order(self, req: dict) -> dict:
        error: EngineError | None = None
        with self._tx():
            view = self._place_order(req)
            if isinstance(view, EngineError):
                error = view
        if error is not None:
            raise error  # raised after commit so the failed attempt stays in the action log
        return view

    def _place_order(self, req: dict) -> dict | EngineError:
        with self._tx():
            t = self.sync()
            try:
                self._require_trading()
                sid = self._sid(req["ticker"])
                qty = req["qty"]
                if not isinstance(qty, int) or isinstance(qty, bool):
                    raise EngineError("Quantity must be a whole number.", 422)
                r = orders.OrderRequest(
                    symbol_id=sid,
                    ticker=self._ticker(sid),
                    side=req["side"],
                    type=req["type"],
                    qty=qty,
                    limit_price=_cents(req.get("limit_price"), "limit_price"),
                    stop_price=_cents(req.get("stop_price"), "stop_price"),
                )
                view, events = orders.submit(self.conn, self.market, t, r)
            except EngineError as e:
                self._log("POST /api/orders", {"request": req, "error": e.message})
                return e
            self._log(
                "POST /api/orders",
                {"request": req, "order_id": view["id"], "status": view["status"]},
            )
            for e in events:
                self._log(f"engine:{e['type']}", e, t)
                self._emit(e)
            if view["status"] == "rejected":
                self._emit(
                    {
                        "type": "order_rejected",
                        "order_id": view["id"],
                        "sim_ts": t,
                        "reason": view["reason"],
                    }
                )
            return view

    @_locked
    def cancel_order(self, order_id: int) -> dict:
        with self._tx():
            t = self.sync()
            self._require_trading()
            view = orders.cancel(self.conn, order_id, t)
            self._log("DELETE /api/orders", {"order_id": order_id})
            self._emit({"type": "order_cancelled", "order_id": order_id, "sim_ts": t})
            return view

    # --- watchlists ------------------------------------------------------------------------

    @_locked
    def watchlists(self) -> list[dict]:
        out = []
        for w in self.conn.execute("SELECT * FROM watchlists ORDER BY id").fetchall():
            items = self.conn.execute(
                "SELECT s.ticker FROM watchlist_items i JOIN symbols s ON s.id = i.symbol_id "
                "WHERE i.watchlist_id = ? ORDER BY i.position",
                (w["id"],),
            )
            out.append({"id": w["id"], "name": w["name"], "tickers": [r[0] for r in items]})
        return out

    def _watchlist(self, wid: int) -> dict:
        for w in self.watchlists():
            if w["id"] == wid:
                return w
        raise EngineError(f"Watchlist {wid} not found.", 404)

    def _check_name(self, name: str, exclude: int | None = None) -> str:
        name = (name or "").strip()
        if not name:
            raise EngineError("Watchlist name cannot be empty.", 422)
        if len(name) > MAX_NAME_LEN:
            raise EngineError(f"Watchlist name must be at most {MAX_NAME_LEN} characters.", 422)
        clash = self.conn.execute(
            "SELECT 1 FROM watchlists WHERE lower(name) = lower(?) AND id IS NOT ?", (name, exclude)
        ).fetchone()
        if clash:
            raise EngineError(f"A watchlist named {name!r} already exists.", 409)
        return name

    @_locked
    def create_watchlist(self, name: str) -> dict:
        with self._tx():
            self.sync()
            name = self._check_name(name)
            cur = self.conn.execute("INSERT INTO watchlists (name) VALUES (?)", (name,))
            self._log("POST /api/watchlists", {"name": name, "id": cur.lastrowid})
            return self._watchlist(cur.lastrowid)

    @_locked
    def rename_watchlist(self, wid: int, name: str) -> dict:
        with self._tx():
            self.sync()
            self._watchlist(wid)
            name = self._check_name(name, wid)
            self.conn.execute("UPDATE watchlists SET name = ? WHERE id = ?", (name, wid))
            self._log("PATCH /api/watchlists", {"id": wid, "name": name})
            return self._watchlist(wid)

    @_locked
    def delete_watchlist(self, wid: int) -> None:
        with self._tx():
            self.sync()
            self._watchlist(wid)
            if self.conn.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0] <= 1:
                raise EngineError("You must keep at least one watchlist.", 409)
            self.conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (wid,))
            self.conn.execute("DELETE FROM watchlists WHERE id = ?", (wid,))
            self._log("DELETE /api/watchlists", {"id": wid})

    @_locked
    def add_watchlist_item(self, wid: int, ticker: str) -> dict:
        with self._tx():
            self.sync()
            w = self._watchlist(wid)
            sid = self._sid(ticker)
            if self._ticker(sid) in w["tickers"]:
                raise EngineError(f"{self._ticker(sid)} is already in {w['name']}.", 409)
            pos = self.conn.execute(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM watchlist_items WHERE watchlist_id = ?",
                (wid,),
            ).fetchone()[0]
            self.conn.execute("INSERT INTO watchlist_items VALUES (?,?,?)", (wid, sid, pos))
            self._log("POST /api/watchlists/items", {"id": wid, "ticker": self._ticker(sid)})
            return self._watchlist(wid)

    @_locked
    def remove_watchlist_item(self, wid: int, ticker: str) -> dict:
        with self._tx():
            self.sync()
            w = self._watchlist(wid)
            sid = self._sid(ticker)
            if self._ticker(sid) not in w["tickers"]:
                raise EngineError(f"{self._ticker(sid)} is not in {w['name']}.", 404)
            self.conn.execute(
                "DELETE FROM watchlist_items WHERE watchlist_id = ? AND symbol_id = ?", (wid, sid)
            )
            self._log("DELETE /api/watchlists/items", {"id": wid, "ticker": self._ticker(sid)})
            return self._watchlist(wid)

    # --- alerts ----------------------------------------------------------------------------

    @_locked
    def list_alerts(self) -> list[dict]:
        self.sync()
        rows = self.conn.execute("SELECT * FROM alerts ORDER BY id").fetchall()
        return [alerts.alert_view(self.conn, r) for r in rows]

    @_locked
    def alert_log(self) -> list[dict]:
        self.sync()
        rows = self.conn.execute(
            "SELECT e.*, s.ticker FROM alert_events e JOIN symbols s ON s.id = e.symbol_id "
            "ORDER BY e.id DESC"
        )
        return [
            {
                "id": r["id"],
                "alert_id": r["alert_id"],
                "ticker": r["ticker"],
                "condition": r["condition"],
                "price": cents_to_usd(r["price"]),
                "trigger_price": cents_to_usd(r["trigger_price"]),
                "sim_ts": r["sim_ts"],
                "time": fmt_hhmmss(r["sim_ts"]),
            }
            for r in rows
        ]

    @_locked
    def create_alert(self, ticker: str, condition: str, price: float, note: str = "") -> dict:
        with self._tx():
            t = self.sync()
            self._require_not_closed()
            sid = self._sid(ticker)
            note = self._check_note(note)
            aid = alerts.create(self.conn, t, sid, condition, _cents(price, "price"), note)
            self._log(
                "POST /api/alerts",
                {
                    "id": aid,
                    "ticker": self._ticker(sid),
                    "condition": condition,
                    "price": price,
                    "note": note,
                },
            )
            return alerts.alert_view(self.conn, alerts.get_alert(self.conn, aid))

    @_locked
    def update_alert(self, alert_id: int, changes: dict) -> dict:
        with self._tx():
            t = self.sync()
            self._require_not_closed()
            c = {k: v for k, v in changes.items() if v is not None}
            if "price" in c:
                c["price"] = _cents(c["price"], "price")
            if "note" in c:
                c["note"] = self._check_note(c["note"])
            alerts.update(self.conn, t, alert_id, c)
            self._log("PATCH /api/alerts", {"id": alert_id, "changes": changes})
            return alerts.alert_view(self.conn, alerts.get_alert(self.conn, alert_id))

    @_locked
    def delete_alert(self, alert_id: int) -> None:
        with self._tx():
            self.sync()
            alerts.delete(self.conn, alert_id)
            self._log("DELETE /api/alerts", {"id": alert_id})

    @staticmethod
    def _check_note(note: str | None) -> str:
        note = (note or "").strip()
        if len(note) > MAX_NOTE_LEN:
            raise EngineError(f"Note must be at most {MAX_NOTE_LEN} characters.", 422)
        return note

    # --- chart preferences / UI state ---------------------------------------------------------

    @_locked
    def get_chart_prefs(self, ticker: str) -> dict:
        sid = self._sid(ticker)
        row = self.conn.execute("SELECT * FROM chart_prefs WHERE symbol_id = ?", (sid,)).fetchone()
        if row is None:
            return {"ticker": self._ticker(sid), **DEFAULT_PREFS}
        return {
            "ticker": self._ticker(sid),
            "timeframe": row["timeframe"],
            "indicators": json.loads(row["indicators_json"]),
        }

    @_locked
    def set_chart_prefs(self, ticker: str, timeframe: str, indicators: list[dict]) -> dict:
        with self._tx():
            self.sync()
            sid = self._sid(ticker)
            if timeframe not in TIMEFRAMES:
                raise EngineError(f"Unknown timeframe {timeframe!r}.", 422)
            clean = self._clean_indicators(indicators)
            self.conn.execute(
                "INSERT INTO chart_prefs VALUES (?,?,?) ON CONFLICT(symbol_id) DO UPDATE SET "
                "timeframe = excluded.timeframe, indicators_json = excluded.indicators_json",
                (sid, timeframe, json.dumps(clean, sort_keys=True, separators=(",", ":"))),
            )
            self._log(
                "PUT /api/chart_prefs",
                {"ticker": self._ticker(sid), "timeframe": timeframe, "indicators": clean},
            )
            return self.get_chart_prefs(ticker)

    @staticmethod
    def _clean_indicators(indicators: list[dict]) -> list[dict]:
        if len(indicators) > MAX_INDICATORS:
            raise EngineError(f"At most {MAX_INDICATORS} indicators.", 422)
        out: list[dict] = []
        for ind in indicators:
            kind = ind.get("type")
            if kind == "volume":
                if {"type": "volume"} in out:
                    raise EngineError("Volume can only be added once.", 422)
                out.append({"type": "volume"})
            elif kind == "sma":
                period = ind.get("period")
                if (
                    not isinstance(period, int)
                    or isinstance(period, bool)
                    or not 1 <= period <= MAX_SMA_PERIOD
                ):
                    raise EngineError(
                        f"SMA period must be a whole number from 1 to {MAX_SMA_PERIOD}.", 422
                    )
                out.append({"type": "sma", "period": period})
            else:
                raise EngineError(f"Unknown indicator {kind!r}. Available: sma, volume.", 422)
        return out

    @_locked
    def get_ui_state(self) -> dict:
        rows = self.conn.execute("SELECT key, value FROM ui_state").fetchall()
        return {r["key"]: r["value"] for r in rows}

    @_locked
    def set_active_symbol(self, ticker: str) -> dict:
        with self._tx():
            self.sync()
            t = self._ticker(self._sid(ticker))
            self.conn.execute(
                "INSERT INTO ui_state VALUES ('active_symbol', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (t,),
            )
            self._log("PUT /api/ui_state", {"active_symbol": t})
            return self.get_ui_state()

    # --- harness-only views ---------------------------------------------------------------------

    @_locked
    def state(self) -> dict:
        with self._tx():
            now = self.sync()
            tables = {}
            for t in (
                "account",
                "positions",
                "orders",
                "trades",
                "watchlists",
                "watchlist_items",
                "alerts",
                "alert_events",
                "chart_prefs",
                "ui_state",
            ):
                tables[t] = [dict(r) for r in self.conn.execute(f"SELECT * FROM {t} ORDER BY 1")]
            return {
                "episode_id": self.episode_id,
                "seed": self.seed,
                "sim_now": now,
                "time": fmt_hhmmss(now),
                "clock_mode": self.clock.mode.value,
                "clock_state": self.clock.state.value,
                "state_hash": state_hash(self.conn),
                "tables": tables,
            }

    @_locked
    def trace(self) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT * FROM action_log ORDER BY id").fetchall()
            return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]
