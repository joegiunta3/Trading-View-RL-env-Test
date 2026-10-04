"""Same seed => byte-identical world data and, for the same actions, identical state.

GOLDEN hashes change only when world generation is changed on purpose. Never update them to
make an unexplained failure go away: a mismatch means the world is no longer reproducible.
"""

import os
import subprocess
import sys

import pytest

from app.db import connect, state_hash, world_hash, write_world
from app.world.generate import build_world
from tests.conftest import make_episode, order

SEEDS = [1, 7, 1234, 99999]
# Changelog: 2026-10-04 regenerated after the intentional addition of 60 prior sessions of
# 1-minute history (daily bars now derived from it; breakout uses the real prior-session high),
# with US market holidays (Thanksgiving, Christmas, New Year's Day) excluded from the sessions.
# 2026-10-04 regenerated again: episodes are two trading days (Jan 15-16); scenarios land on
# either day; path table gained a day column.
GOLDEN = {
    1234: "e28f0ea799f52b41a9921b43079a97550e91b2cebd506aa325d840b424e316d8",
    99999: "1235c549b8c8e865327011050ff0b449eb1d3e704d560ff98f8df9d301b9b99a",
}


def fresh_world_hash(seed: int) -> str:
    world = build_world.__wrapped__(seed)  # bypass the in-process cache
    conn = connect()
    write_world(conn, world)
    return world_hash(conn, world.truth_json)


@pytest.mark.parametrize("seed", SEEDS)
def test_same_seed_same_world_hash(seed):
    assert fresh_world_hash(seed) == fresh_world_hash(seed)


@pytest.mark.parametrize("seed", sorted(GOLDEN))
def test_golden_world_hash(seed):
    assert fresh_world_hash(seed) == GOLDEN[seed]


def test_different_seeds_differ():
    hashes = {fresh_world_hash(s) for s in SEEDS}
    assert len(hashes) == len(SEEDS)


def test_independent_of_hash_randomization():
    code = (
        "from app.db import connect, write_world, world_hash;"
        "from app.world.generate import build_world;"
        "w = build_world(1234); c = connect(); write_world(c, w);"
        "print(world_hash(c, w.truth_json))"
    )
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outs = set()
    for hashseed in ("0", "1", "4242"):
        env = {**os.environ, "PYTHONHASHSEED": hashseed, "PYTHONPATH": root}
        out = subprocess.run(
            [sys.executable, "-c", code],
            env=env,
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        )
        outs.add(out.stdout.strip())
    assert outs == {GOLDEN[1234]}


def scripted_episode(seed: int) -> str:
    """A fixed sequence of actions on the fixed-step clock; returns the final state hash."""
    e = make_episode(seed, setup={"positions": [{"ticker": "KO", "qty": 50, "avg_price": 60.00}]})
    e.advance(120)
    order(e, "AAPL", "buy", "market", 25)
    order(e, "MSFT", "short", "market", 10)
    last = e.quote("NVDA")["last"]
    order(e, "NVDA", "buy", "limit", 5, limit_price=round(last * 0.995, 2))
    order(e, "KO", "sell", "stop", 50, stop_price=round(e.quote("KO")["last"] * 0.99, 2))
    e.create_alert("JPM", "crossing_up", round(e.quote("JPM")["last"] * 1.003, 2), "note")
    wl = e.create_watchlist("Energy")
    for t in ("XOM", "CVX", "COP"):
        e.add_watchlist_item(wl["id"], t)
    e.set_layout("4")
    e.update_pane(2, "AAPL", "15m", [{"type": "sma", "period": 20}, {"type": "volume"}])
    e.set_active_pane(3)
    e.advance(3600)
    order(e, "MSFT", "cover", "market", 10)
    e.advance(27000)
    return state_hash(e.conn)


@pytest.mark.parametrize("seed", SEEDS)
def test_same_actions_same_state(seed):
    assert scripted_episode(seed) == scripted_episode(seed)
