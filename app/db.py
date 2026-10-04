"""SQLite setup. Each seed's world tables are built once into an in-memory template and
copied into a fresh episode database on reset."""

import hashlib
import json
import sqlite3
from functools import lru_cache
from pathlib import Path

from app.world.generate import World, build_world

SCHEMA = (Path(__file__).parent / "schema.sql").read_text()
WORLD_TABLES = ("symbols", "path", "daily_bars")
STATE_TABLES = (
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
)


def connect(path: str | Path = ":memory:") -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    return conn


def write_world(conn: sqlite3.Connection, world: World) -> None:
    conn.executescript(SCHEMA)
    conn.execute("BEGIN")
    conn.executemany(
        "INSERT INTO symbols VALUES (?,?,?,?,?)",
        [(s.id, s.ticker, s.name, s.sector, s.spread) for s in world.symbols],
    )
    for s in world.symbols:
        px, vol = world.px[s.id - 1], world.vol[s.id - 1]
        conn.executemany(
            "INSERT INTO path VALUES (?,?,?,?)",
            ((s.id, i, px[i], vol[i]) for i in range(len(px))),
        )
        conn.executemany(
            "INSERT INTO daily_bars VALUES (?,?,?,?,?,?,?)",
            [(s.id, b.date, b.o, b.h, b.l, b.c, b.v) for b in world.daily[s.id - 1]],
        )
    conn.execute("COMMIT")


@lru_cache(maxsize=4)
def _template(seed: int) -> sqlite3.Connection:
    conn = connect()
    write_world(conn, build_world(seed))
    return conn


def new_episode_db(seed: int, path: str | Path = ":memory:") -> sqlite3.Connection:
    """Fresh DB containing the seed's world tables and empty state tables."""
    if path != ":memory:":
        Path(path).unlink(missing_ok=True)
    conn = connect(path)
    _template(seed).backup(conn)
    return conn


def _dump(conn: sqlite3.Connection, table: str, exclude: tuple[str, ...] = ()) -> bytes:
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] not in exclude]
    rows = conn.execute(f"SELECT {','.join(cols)} FROM {table} ORDER BY 1,2").fetchall()
    return json.dumps([table, cols, [tuple(r) for r in rows]], separators=(",", ":")).encode()


def world_hash(conn: sqlite3.Connection, truth_json: str) -> str:
    """sha256 over a canonical dump of world tables plus canonical world_truth."""
    h = hashlib.sha256()
    for t in WORLD_TABLES:
        h.update(_dump(conn, t))
    h.update(truth_json.encode())
    return h.hexdigest()


def state_hash(conn: sqlite3.Connection) -> str:
    """sha256 over episode state tables and the action log (excluding real wall_ts)."""
    h = hashlib.sha256()
    for t in STATE_TABLES:
        h.update(_dump(conn, t))
    h.update(_dump(conn, "action_log", exclude=("wall_ts",)))
    return h.hexdigest()
