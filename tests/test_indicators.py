"""Indicator math (hand-checked values) and indicator config validation."""

import pytest
from fastapi.testclient import TestClient

from app import indicators as ind
from app.api.env import create_env_app
from app.holder import EnvHolder
from tests.conftest import raises_engine


def bars_from(closes, dates=None, highs=None, lows=None, vols=None):
    n = len(closes)
    return [
        {
            "o": c,
            "h": (highs or closes)[i],
            "l": (lows or closes)[i],
            "c": c,
            "v": (vols or [100] * n)[i],
            "date": (dates or ["2026-01-15"] * n)[i],
        }
        for i, c in enumerate(closes)
    ]


def test_sma_and_ema_seeded_with_sma():
    vals = [float(x) for x in range(1, 11)]
    assert ind.sma(vals, 3)[:4] == [None, None, 2.0, 3.0]
    e = ind.ema(vals, 3)  # alpha 0.5, seed = mean(1,2,3) = 2
    assert e[:2] == [None, None]
    assert e[2:] == pytest.approx([x - 1 for x in vals[2:]])


def test_rsi_wilder_hand_checked():
    closes = [1, 2, 1, 2, 1]
    r = ind.rsi(bars_from(closes), 2)
    assert r[:2] == [None, None]
    assert r[2] == pytest.approx(50.0)  # avg gain 0.5, avg loss 0.5
    assert r[3] == pytest.approx(75.0)  # gain: (0.5+1)/2=0.75, loss: 0.25 -> RS 3
    assert ind.rsi(bars_from([1, 2, 3, 4, 5]), 2)[4] == 100.0


def test_macd_is_zero_on_a_flat_series():
    m = ind.macd(bars_from([10.0] * 40), 12, 26, 9)
    assert m["macd"][24] is None and m["macd"][25] == pytest.approx(0.0)
    assert m["signal"][33] == pytest.approx(0.0) and m["signal"][32] is None
    assert m["histogram"][39] == pytest.approx(0.0)


def test_kdj_and_bollinger_on_flat_series():
    k = ind.kdj(bars_from([5.0] * 12), 9, 3, 3)
    assert k["k"][7] is None and (k["k"][8], k["d"][8], k["j"][8]) == (50.0, 50.0, 50.0)
    b = ind.bollinger(bars_from([5.0] * 25), 20, 2.0)
    assert b["upper"][19] == b["middle"][19] == b["lower"][19] == 5.0


def test_kdj_hand_checked():
    # 3-bar window: highs/lows span 10..20, close 20 -> RSV 100; K=(2*50+100)/3, D=(2*50+K)/3
    k = ind.kdj(bars_from([15, 15, 20], highs=[20, 15, 20], lows=[10, 15, 15]), 3, 3, 3)
    assert k["k"][2] == pytest.approx(200 / 3)
    assert k["d"][2] == pytest.approx((100 + 200 / 3) / 3)
    assert k["j"][2] == pytest.approx(3 * k["k"][2] - 2 * k["d"][2])


def test_vwap_resets_each_session():
    bars = bars_from(
        [10.0, 20.0, 30.0],
        dates=["2026-01-14", "2026-01-14", "2026-01-15"],
        vols=[100, 300, 50],
    )
    v = ind.vwap(bars)
    assert v[0] == 10.0 and v[1] == pytest.approx((10 * 100 + 20 * 300) / 400) and v[2] == 30.0


def test_indicator_configs_get_defaults_and_bounds(ep):
    lay = ep.update_pane(
        0,
        indicators=[
            {"type": "rsi"},
            {"type": "macd"},
            {"type": "kdj"},
            {"type": "bb"},
            {"type": "ema", "period": 9},
        ],
    )
    assert lay["panes"][0]["indicators"] == [
        {"type": "rsi", "period": 14},
        {"type": "macd", "fast": 12, "slow": 26, "signal": 9},
        {"type": "kdj", "period": 9, "k": 3, "d": 3},
        {"type": "bb", "period": 20, "stddev": 2.0},
        {"type": "ema", "period": 9},
    ]
    bad = [
        [{"type": "rsi", "period": 1}],
        [{"type": "macd", "fast": 26, "slow": 12}],
        [{"type": "bb", "stddev": 9}],
        [{"type": "ema", "period": 20}, {"type": "ema", "period": 20}],
        [
            {"type": "rsi"},
            {"type": "rsi", "period": 7},
            {"type": "macd"},
            {"type": "kdj"},
        ],  # 4 panes
        [{"type": "stoch"}],
    ]
    for inds in bad:
        raises_engine(ep.update_pane, 0, indicators=inds, status=422)


def test_env_indicator_endpoint_matches_library(tmp_path):
    holder = EnvHolder(data_dir=tmp_path, token="t")
    env = TestClient(create_env_app(holder))
    h = {"X-Env-Token": "t"}
    env.post("/_env/reset", json={"seed": 1234, "clock_mode": "fixed-step"}, headers=h)
    env.post("/_env/start", headers=h)
    env.post("/_env/clock/advance", json={"sim_seconds": 5400}, headers=h)
    r = env.post(
        "/_env/indicators",
        json={"ticker": "AAPL", "timeframe": "5m", "indicator": {"type": "rsi"}},
        headers=h,
    ).json()
    bars = holder.episode.bars("AAPL", "5m")
    assert len(r["bars"]) == len(bars) and r["indicator"] == {"type": "rsi", "period": 14}
    expected = ind.rsi(bars, 14)
    assert r["bars"][-1]["rsi"] == round(expected[-1], 4)
    assert r["bars"][-1]["time"] == bars[-1]["time"]


def test_hidden_flag_is_kept_and_does_not_change_identity(ep):
    lay = ep.update_pane(
        0, indicators=[{"type": "rsi", "hidden": True}, {"type": "ema", "hidden": False}]
    )
    assert lay["panes"][0]["indicators"] == [
        {"type": "rsi", "period": 14, "hidden": True},
        {"type": "ema", "period": 20},
    ]
    raises_engine(
        ep.update_pane, 0, indicators=[{"type": "rsi"}, {"type": "rsi", "hidden": True}], status=422
    )
    raises_engine(ep.update_pane, 0, indicators=[{"type": "rsi", "hidden": "yes"}], status=422)
