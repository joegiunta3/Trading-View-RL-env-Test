"""Price alerts evaluated on the path price each sim second after creation. Fire once."""

import sqlite3

from app.engine.errors import EngineError
from app.market import MarketData
from app.timeline import fmt_ts
from app.timeutil import cents_to_usd

CONDITIONS = ("above", "below", "crossing_up", "crossing_down")


def _hit(condition: str, level: int, prev: int, p: int) -> bool:
    if condition == "above":
        return p >= level
    if condition == "below":
        return p <= level
    if condition == "crossing_up":
        return prev < level <= p
    return prev > level >= p


def _validate(condition: str, price: int) -> None:
    if condition not in CONDITIONS:
        raise EngineError(f"Unknown alert condition {condition!r}.", 422)
    if price <= 0:
        raise EngineError("Alert price must be above $0.", 422)


def get_alert(conn: sqlite3.Connection, alert_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if row is None:
        raise EngineError(f"Alert {alert_id} not found.", 404)
    return row


def create(
    conn: sqlite3.Connection, t: int, sid: int, condition: str, price: int, note: str
) -> int:
    _validate(condition, price)
    cur = conn.execute(
        "INSERT INTO alerts (symbol_id, condition, price, note, enabled, created_sim_ts) "
        "VALUES (?,?,?,?,1,?)",
        (sid, condition, price, note, t),
    )
    return cur.lastrowid


def update(conn: sqlite3.Connection, t: int, alert_id: int, changes: dict) -> None:
    """Edit fields. Changing condition, price or enabled re-arms the alert from second t."""
    row = get_alert(conn, alert_id)
    condition = changes.get("condition", row["condition"])
    price = changes.get("price", row["price"])
    note = changes.get("note", row["note"])
    enabled = int(changes.get("enabled", bool(row["enabled"])))
    _validate(condition, price)
    rearm = (condition, price, enabled) != (row["condition"], row["price"], row["enabled"])
    conn.execute(
        "UPDATE alerts SET condition = ?, price = ?, note = ?, enabled = ?, "
        "created_sim_ts = ?, triggered_sim_ts = ? WHERE id = ?",
        (
            condition,
            price,
            note,
            enabled,
            t if rearm else row["created_sim_ts"],
            None if rearm else row["triggered_sim_ts"],
            alert_id,
        ),
    )


def delete(conn: sqlite3.Connection, alert_id: int) -> None:
    get_alert(conn, alert_id)
    conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))


def active(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM alerts WHERE enabled = 1 AND triggered_sim_ts IS NULL ORDER BY id"
    ).fetchall()


def process_second(conn: sqlite3.Connection, market: MarketData, s: int) -> list[dict]:
    events = []
    for a in active(conn):
        if a["created_sim_ts"] >= s:
            continue
        sid = a["symbol_id"]
        p, prev = market.price(sid, s), market.price(sid, s - 1)
        if not _hit(a["condition"], a["price"], prev, p):
            continue
        conn.execute("UPDATE alerts SET triggered_sim_ts = ? WHERE id = ?", (s, a["id"]))
        conn.execute(
            "INSERT INTO alert_events (alert_id, symbol_id, condition, price, trigger_price, sim_ts) "
            "VALUES (?,?,?,?,?,?)",
            (a["id"], sid, a["condition"], a["price"], p, s),
        )
        events.append(
            {
                "type": "alert_triggered",
                "alert_id": a["id"],
                "ticker": market.world.symbols[sid - 1].ticker,
                "condition": a["condition"],
                "price": cents_to_usd(a["price"]),
                "trigger_price": cents_to_usd(p),
                "note": a["note"],
                "sim_ts": s,
            }
        )
    return events


def alert_view(conn: sqlite3.Connection, a: sqlite3.Row) -> dict:
    ticker = conn.execute("SELECT ticker FROM symbols WHERE id = ?", (a["symbol_id"],)).fetchone()[
        0
    ]
    return {
        "id": a["id"],
        "ticker": ticker,
        "condition": a["condition"],
        "price": cents_to_usd(a["price"]),
        "note": a["note"],
        "enabled": bool(a["enabled"]),
        "created_sim_ts": a["created_sim_ts"],
        "triggered_sim_ts": a["triggered_sim_ts"],
        "created_time": fmt_ts(a["created_sim_ts"]),
        "triggered_time": fmt_ts(a["triggered_sim_ts"]),
        "status": "triggered"
        if a["triggered_sim_ts"] is not None
        else ("active" if a["enabled"] else "disabled"),
    }
