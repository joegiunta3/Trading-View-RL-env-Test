"""Backtest engine (hand-checked), strategy validation, pane storage and endpoints."""

import pytest
from fastapi.testclient import TestClient

from app import strategies as st
from app.api.env import create_env_app
from app.api.public import create_public_app
from app.holder import EnvHolder
from tests.conftest import raises_engine

# fast=1 (the close itself) vs slow=2 (mean of the last two closes): fast > slow iff the close rose.
CLOSES = [5, 4, 3, 4, 5, 6, 5, 4, 5, 6]


def make_bars(closes):
    return [
        {
            "time": 1_000_000 + 60 * i,
            "date": "2026-01-15",
            "label": f"10:{i:02d}",
            "o": c - 0.25,
            "h": c + 0.5,
            "l": c - 0.5,
            "c": float(c),
            "v": 100,
        }
        for i, c in enumerate(closes)
    ]


MA = {"type": "ma_cross", "fast": 1, "slow": 2, "qty": 10, "direction": "both"}


def test_ma_cross_signals_at_close_fill_next_open_and_reverse():
    bars = make_bars(CLOSES)
    assert st.signals(bars, len(bars), MA) == [0, 0, 0, 1, 0, 0, -1, 0, 1, 0]
    r = st.backtest(bars, len(bars), MA)
    t1, t2, t3 = r["trades"]
    assert (
        t1["side"],
        t1["entry_index"],
        t1["entry_price"],
        t1["exit_index"],
        t1["exit_price"],
    ) == ("long", 4, 4.75, 7, 3.75)
    assert t1["pnl"] == -10.0 and t1["return_pct"] == round(-10 / 47.5 * 100, 2)
    assert (t2["side"], t2["entry_price"], t2["exit_price"], t2["pnl"]) == (
        "short",
        3.75,
        5.75,
        -20.0,
    )
    assert (
        t3["open"] and t3["entry_price"] == 5.75 and t3["pnl"] == 2.5
    )  # marked at the last close 6
    s = r["stats"]
    assert (s["total_pnl"], s["total_trades"], s["winning_trades"], s["profit_factor"]) == (
        -30.0,
        2,
        0,
        0.0,
    )
    assert s["open_pnl"] == 2.5 and t1["entry_when"] == "Jan 15, 2026, 10:04"


def test_forming_bar_is_not_used_for_signals_and_pending_signals_wait():
    bars = make_bars(CLOSES)
    r = st.backtest(bars, len(bars) - 1, MA)  # bar 9 still forming: signal at 8 fills at its open
    assert (
        r["trades"][-1]["entry_index"] == 9 and r["trades"][-1]["pnl"] == -7.5
    )  # marked at close 5
    r = st.backtest(bars[:9], 9, MA)  # long signal at bar 8 but no next bar yet: not filled
    assert len(r["trades"]) == 2  # the short from bar 7 is still open; no reversal yet
    assert (r["trades"][-1]["side"], r["trades"][-1]["open"]) == ("short", True)


def test_long_only_closes_instead_of_shorting():
    r = st.backtest(make_bars(CLOSES), 10, MA | {"direction": "long"})
    assert [(t["side"], t["open"]) for t in r["trades"]] == [("long", False), ("long", True)]
    assert r["trades"][0]["exit_index"] == 7


def test_rsi_reversal_hand_checked():
    # RSI(2): 50, 75, 37.5, 79.17 ... crosses down through 70 at bar 4, up through 40 at bar 5
    cfg = {
        "type": "rsi_reversal",
        "period": 2,
        "oversold": 40,
        "overbought": 70,
        "qty": 1,
        "direction": "both",
    }
    bars = make_bars([1, 2, 1, 2, 1, 3, 3])
    assert st.signals(bars, 7, cfg) == [0, 0, 0, 0, -1, 1, 0]
    trades = st.backtest(bars, 7, cfg)["trades"]
    assert [(t["side"], t["entry_index"], t.get("exit_index")) for t in trades] == [
        ("short", 5, 6),
        ("long", 6, None),
    ]


def test_drawdown_and_profit_factor_from_equity():
    r = st.backtest(make_bars(CLOSES), 10, MA)
    eq = [st.INITIAL_CAPITAL + e["pnl"] for e in r["equity"]]
    peak, worst = eq[0], 0.0
    for x in eq:
        peak = max(peak, x)
        worst = max(worst, peak - x)
    assert r["stats"]["max_drawdown"] == round(worst, 2) > 0
    assert all("buy_hold" in e for e in r["equity"])


def test_strategy_validation_and_pane_storage(ep):
    lay = ep.update_pane(0, strategy={"type": "ma_cross"})
    assert lay["panes"][0]["strategy"] == {
        "type": "ma_cross",
        "fast": 9,
        "slow": 21,
        "qty": 100,
        "direction": "both",
    }
    assert ep.update_pane(0, ticker="MSFT")["panes"][0]["strategy"]["type"] == "ma_cross"  # kept
    for bad in (
        {"type": "macd_cross"},
        {"type": "ma_cross", "fast": 30, "slow": 20},
        {"type": "rsi_reversal", "oversold": 80, "overbought": 70},
        {"type": "ma_cross", "qty": 0},
        {"type": "ma_cross", "direction": "sideways"},
    ):
        raises_engine(ep.update_pane, 0, strategy=bad, status=422)
    assert ep.update_pane(0, strategy=None)["panes"][0]["strategy"] is None
    log = [a for a in ep.trace() if a["endpoint"] == "PUT /api/panes"]
    assert "strategy" in log[0]["payload"] and log[-1]["payload"]["strategy"] is None


def test_backtest_endpoints_agree_and_use_only_closed_bars(tmp_path):
    holder = EnvHolder(data_dir=tmp_path, token="t")
    pub, env = TestClient(create_public_app(holder)), TestClient(create_env_app(holder))
    h = {"X-Env-Token": "t"}
    env.post("/_env/reset", json={"seed": 1234, "clock_mode": "fixed-step"}, headers=h)
    env.post("/_env/start", headers=h)
    env.post("/_env/clock/advance", json={"sim_seconds": 9000}, headers=h)
    assert pub.get("/api/panes/0/backtest").status_code == 404  # no strategy yet
    pub.put("/api/panes/0", json={"timeframe": "15m", "strategy": {"type": "ma_cross"}})
    a = pub.get("/api/panes/0/backtest").json()
    ticker = a["ticker"]
    b = env.post(
        "/_env/backtest",
        json={"ticker": ticker, "timeframe": "15m", "strategy": {"type": "ma_cross"}},
        headers=h,
    ).json()
    assert a["trades"] == b["trades"] and a["stats"] == b["stats"]
    bars = holder.episode.bars(ticker, "15m")
    assert a["bars_tested"] == len(bars) - 1  # the 11:30 bar is still forming
    assert a["stats"]["total_trades"] > 0 and a["range"]["to"].endswith("11:15")


@pytest.mark.parametrize("seed", [1, 1234])
def test_real_world_backtests_are_consistent(seed):
    from tests.conftest import make_episode

    e = make_episode(seed, start_day=2, start_time="16:00")
    for cfg in ({"type": "ma_cross"}, {"type": "rsi_reversal"}):
        r = e.backtest("AAPL", "1h", cfg)
        closed = [t for t in r["trades"] if not t["open"]]
        assert r["stats"]["total_pnl"] == round(sum(t["pnl"] for t in closed), 2)
        for t in r["trades"]:
            assert t["entry_index"] < t.get("exit_index", 10**9)
