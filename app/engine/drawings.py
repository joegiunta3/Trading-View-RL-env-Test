"""Chart drawings: lines anchored to (bar time, price), stored per symbol.

Points are data coordinates, not pixels: `time` is a bar's epoch-seconds label as served by
/api/bars (it may lie to the right of the last bar: drawing into empty future space is allowed
and reveals nothing), `price` is in cents.
"""

import json
import sqlite3
from datetime import UTC, datetime

from app.engine.errors import EngineError
from app.timeutil import cents_to_usd

POINTS_PER_KIND = {"info_line": 2, "trendline": 2, "horizontal_line": 1, "vertical_line": 1}
KIND_LABEL = {
    "info_line": "Info line",
    "trendline": "Trendline",
    "horizontal_line": "Horizontal line",
    "vertical_line": "Vertical line",
}
MAX_DRAWINGS = 200
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
# Bar times are UTC-labelled epochs, so any time within ±10 years of the session is plausible.
_MIN_TIME, _MAX_TIME = 1_450_000_000, 2_100_000_000


def time_label(epoch: int) -> str:
    """Bar epoch -> 'Jan 15 10:05' ('Jan 14' for daily bars at midnight). Pure formatting."""
    dt = datetime.fromtimestamp(epoch, UTC)
    day = f"{_MONTHS[dt.month - 1]} {dt.day}"
    return day if dt.hour == 0 and dt.minute == 0 else f"{day} {dt.hour:02d}:{dt.minute:02d}"


def clean_points(kind: str, points: list[dict]) -> list[dict]:
    """Validate and normalise points to [{"time": int, "price": cents}]."""
    if kind not in POINTS_PER_KIND:
        raise EngineError(
            f"Unknown drawing {kind!r}. Available: {', '.join(POINTS_PER_KIND)}.", 422
        )
    if not isinstance(points, list) or len(points) != POINTS_PER_KIND[kind]:
        raise EngineError(
            f"A {KIND_LABEL[kind].lower()} needs {POINTS_PER_KIND[kind]} point(s).", 422
        )
    out = []
    for p in points:
        t, price = p.get("time"), p.get("price")
        if not isinstance(t, int) or isinstance(t, bool) or not _MIN_TIME <= t <= _MAX_TIME:
            raise EngineError("Each point needs a bar time (epoch seconds).", 422)
        if not isinstance(price, int | float) or isinstance(price, bool) or not 0 < price < 1e7:
            raise EngineError("Each point needs a price above 0.", 422)
        out.append({"time": t, "price": int(round(price * 100))})
    return out


def stats(kind: str, pts: list[dict]) -> dict | None:
    """Price change from point 1 to point 2 (the numbers an info line shows)."""
    if POINTS_PER_KIND[kind] != 2:
        return None
    a, b = pts[0]["price"], pts[1]["price"]
    return {
        "price_change": cents_to_usd(b - a),
        "pct_change": round((b - a) / a * 100, 2),
        "change_cents": b - a,
        "time_span_seconds": pts[1]["time"] - pts[0]["time"],
    }


def view(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    pts = json.loads(row["points_json"])
    ticker = conn.execute(
        "SELECT ticker FROM symbols WHERE id = ?", (row["symbol_id"],)
    ).fetchone()[0]
    return {
        "id": row["id"],
        "ticker": ticker,
        "kind": row["kind"],
        "label": KIND_LABEL[row["kind"]],
        "points": [
            {"time": p["time"], "price": cents_to_usd(p["price"]), "label": time_label(p["time"])}
            for p in pts
        ],
        "stats": stats(row["kind"], pts),
        "created_sim_ts": row["created_sim_ts"],
        "updated_sim_ts": row["updated_sim_ts"],
    }


def get_row(conn: sqlite3.Connection, drawing_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM drawings WHERE id = ?", (drawing_id,)).fetchone()
    if row is None:
        raise EngineError(f"Drawing {drawing_id} not found.", 404)
    return row


def create(conn: sqlite3.Connection, t: int, sid: int, kind: str, points: list[dict]) -> int:
    pts = clean_points(kind, points)
    if conn.execute("SELECT COUNT(*) FROM drawings").fetchone()[0] >= MAX_DRAWINGS:
        raise EngineError(f"At most {MAX_DRAWINGS} drawings.", 409)
    cur = conn.execute(
        "INSERT INTO drawings (symbol_id, kind, points_json, created_sim_ts, updated_sim_ts) "
        "VALUES (?,?,?,?,?)",
        (sid, kind, json.dumps(pts, separators=(",", ":")), t, t),
    )
    return cur.lastrowid


def move(conn: sqlite3.Connection, t: int, drawing_id: int, points: list[dict]) -> None:
    row = get_row(conn, drawing_id)
    pts = clean_points(row["kind"], points)
    conn.execute(
        "UPDATE drawings SET points_json = ?, updated_sim_ts = ? WHERE id = ?",
        (json.dumps(pts, separators=(",", ":")), t, drawing_id),
    )
