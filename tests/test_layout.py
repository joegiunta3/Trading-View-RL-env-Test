"""Multi-chart layouts: 1/2/3/4 panes, per-pane settings, active pane, logging, setup."""

import json

import pytest
from fastapi.testclient import TestClient

from app.api.env import create_env_app
from app.api.public import create_public_app
from app.holder import EnvHolder
from app.timeutil import cents_to_usd
from tests.conftest import make_episode, raises_engine


def test_default_layout_is_single_chart_with_four_preset_panes(ep):
    lay = ep.get_layout()
    assert lay["layout"] == "1" and lay["active_pane"] == 0
    assert [p["pane"] for p in lay["panes"]] == [0, 1, 2, 3]
    assert [p["ticker"] for p in lay["panes"]] == list(ep.world.default_watchlist[:4])
    assert all(
        p["timeframe"] == "5m" and p["indicators"] == [{"type": "volume"}] for p in lay["panes"]
    )


@pytest.mark.parametrize("layout,visible", [("1", 1), ("2", 2), ("3", 3), ("4", 4)])
def test_only_visible_panes_can_be_changed_or_activated(ep, layout, visible):
    ep.set_layout(layout)
    for pane in range(4):
        if pane < visible:
            ep.update_pane(pane, timeframe="1h")
            ep.set_active_pane(pane)
        else:
            raises_engine(ep.update_pane, pane, timeframe="1h", status=404, match="not shown")
            raises_engine(ep.set_active_pane, pane, status=404)


def test_shrinking_keeps_hidden_pane_settings_and_resets_hidden_active_pane(ep):
    ep.set_layout("4")
    ep.update_pane(3, "NVDA", "15m", [{"type": "sma", "period": 50}])
    ep.set_active_pane(3)
    lay = ep.set_layout("2")
    assert lay["active_pane"] == 0  # pane 3 is hidden now
    assert lay["panes"][3] == {
        "pane": 3,
        "ticker": "NVDA",
        "timeframe": "15m",
        "indicators": [{"type": "sma", "period": 50}],
    }
    assert ep.set_layout("4")["panes"][3]["ticker"] == "NVDA"


def test_pane_validation(ep):
    raises_engine(ep.set_layout, "5", status=422)
    raises_engine(ep.update_pane, 0, ticker="ZZZZ", status=404)
    raises_engine(ep.update_pane, 0, timeframe="2m", status=422)
    raises_engine(ep.update_pane, 0, indicators=[{"type": "sma", "period": 0}], status=422)
    raises_engine(
        ep.update_pane,
        0,
        indicators=[{"type": "sma", "period": 20}] * 2,
        status=422,
        match="already",
    )
    ep.update_pane(0, indicators=[{"type": "sma", "period": 20}, {"type": "sma", "period": 50}])


def test_layout_changes_are_logged_with_sim_time(ep):
    ep.advance(90)
    ep.set_layout("3")
    ep.update_pane(2, ticker="xom", timeframe="1m")
    ep.set_active_pane(2)
    log = [(a["endpoint"], a["sim_ts"], a["payload"]) for a in ep.trace()]
    assert ("PUT /api/layout", 90, {"layout": "3"}) in log
    assert ("PUT /api/panes", 90, {"pane": 2, "ticker": "XOM", "timeframe": "1m"}) in log
    assert ("PUT /api/layout/active", 90, {"pane": 2}) in log


def test_setup_can_prepare_a_layout():
    e = make_episode(
        setup={
            "layout": "4",
            "active_pane": 2,
            "panes": [{"pane": 1, "ticker": "GS", "timeframe": "1h", "indicators": []}],
        }
    )
    lay = e.get_layout()
    assert lay["layout"] == "4" and lay["active_pane"] == 2
    assert lay["panes"][1] == {"pane": 1, "ticker": "GS", "timeframe": "1h", "indicators": []}
    raises_engine(make_episode, setup={"layout": "2", "active_pane": 3}, status=422)


def test_layout_is_in_env_state(ep):
    ep.set_layout("2")
    tables = ep.state()["tables"]
    assert {r["key"]: r["value"] for r in tables["ui_state"]}["layout"] == "2"
    assert len(tables["chart_panes"]) == 4


def test_websocket_streams_bars_for_every_subscribed_pane(tmp_path):
    holder = EnvHolder(data_dir=tmp_path, token="t")
    pub, env = TestClient(create_public_app(holder)), TestClient(create_env_app(holder))
    env.post(
        "/_env/reset", json={"seed": 1234, "clock_mode": "fixed-step"}, headers={"X-Env-Token": "t"}
    )
    env.post("/_env/start", headers={"X-Env-Token": "t"})
    env.post("/_env/clock/advance", json={"sim_seconds": 4000}, headers={"X-Env-Token": "t"})
    subs = [
        {"ticker": "AAPL", "tf": "1m"},
        {"ticker": "XOM", "tf": "5m"},
        {"ticker": "GS", "tf": "1h"},
        {"ticker": "KO", "tf": "1D"},
    ]
    with pub.websocket_connect("/ws") as ws:
        ws.send_json({"subscribe": subs})
        tick = None
        for _ in range(4):  # the first tick may predate the subscription
            f = ws.receive_json()
            if f["type"] == "tick" and len(f["bars"]) == 4:
                tick = f
                break
    assert tick is not None
    e = holder.episode
    for sub, entry in zip(subs, tick["bars"], strict=True):
        assert (entry["ticker"], entry["timeframe"]) == (sub["ticker"], sub["tf"])
        assert entry["bars"] == e.bars(sub["ticker"], sub["tf"])[-2:]
        sid = e.world.by_ticker[sub["ticker"]].id
        assert entry["bars"][-1]["c"] == cents_to_usd(e.world.px[sid - 1][4000])
    assert "world_truth" not in json.dumps(tick)
