"""HTTP surface: port separation, env token, public endpoints, and no-leak guarantees."""

import json

import pytest
from fastapi.testclient import TestClient

from app.api.env import create_env_app
from app.api.public import create_public_app
from app.config import SESSION_DATE, SESSION_SECONDS
from app.holder import EnvHolder
from app.market import HISTORY_SESSIONS
from app.timeutil import cents_to_usd, sim_epoch

TOKEN = "test-token"
H = {"X-Env-Token": TOKEN}
FORBIDDEN = (
    "world_truth",
    "scenario",
    "breakout",
    "fakeout",
    "sharp_drop",
    "volume_surge",
    "spike",
    "roles",
    "t1_sec",
    "_env",
    "attempt",
)


@pytest.fixture
def clients(tmp_path):
    holder = EnvHolder(data_dir=tmp_path, token=TOKEN)
    return TestClient(create_public_app(holder)), TestClient(create_env_app(holder)), holder


def reset(env, **kw):
    body = {"seed": 1234, "clock_mode": "fixed-step", **kw}
    r = env.post("/_env/reset", json=body, headers=H)
    assert r.status_code == 200, r.text
    assert env.post("/_env/start", headers=H).status_code == 200
    return r.json()


def test_public_app_has_no_env_routes(clients):
    pub, _, _ = clients
    paths = [getattr(r, "path", "") for r in pub.app.routes]
    assert not any(p.startswith("/_env") for p in paths)
    for method, path in [
        ("post", "/_env/reset"),
        ("post", "/_env/start"),
        ("get", "/_env/state"),
        ("post", "/_env/clock/advance"),
        ("get", "/_env/trace"),
        ("post", "/_env/grade"),
    ]:
        assert getattr(pub, method)(path).status_code in (404, 405)
    assert pub.get("/docs").status_code == 404 and pub.get("/openapi.json").status_code == 404


def test_public_app_cannot_move_clock(clients):
    pub, env, _ = clients
    reset(env)
    clock_routes = [r for r in pub.app.routes if "clock" in getattr(r, "path", "")]
    assert all(r.methods == {"GET"} for r in clock_routes)
    assert pub.post("/api/clock", json={"sim_now": 999}).status_code == 405
    assert pub.get("/api/clock").json()["sim_now"] == 0


def test_env_requires_token(clients):
    _, env, _ = clients
    assert env.post("/_env/reset", json={"seed": 1}).status_code == 401
    assert (
        env.post("/_env/reset", json={"seed": 1}, headers={"X-Env-Token": "nope"}).status_code
        == 401
    )
    assert env.get("/_env/state").status_code == 401


def test_public_503_before_reset(clients):
    pub, _, _ = clients
    assert pub.get("/api/quotes").status_code == 503


def test_env_flow_and_truth_file_location(clients, tmp_path):
    pub, env, holder = clients
    ep_id = reset(env, start_time="10:00")["episode_id"]
    assert (tmp_path / "episodes" / ep_id / "world_truth.json").exists()
    assert pub.get(f"/data/episodes/{ep_id}/world_truth.json").status_code == 404
    r = env.post("/_env/clock/advance", json={"sim_seconds": 60}, headers=H)
    assert r.json()["time"] == "10:01:00"
    assert env.post("/_env/clock/advance", json={"sim_seconds": 1.5}, headers=H).status_code == 422
    assert env.post("/_env/grade", json={"task_id": "t1"}, headers=H).status_code == 501
    state = env.get("/_env/state", headers=H).json()
    assert state["sim_now"] == 3660 and state["clock_mode"] == "fixed-step"


def test_env_realtime_advance_conflict(clients):
    _, env, _ = clients
    env.post("/_env/reset", json={"seed": 1, "clock_mode": "realtime"}, headers=H)
    env.post("/_env/start", headers=H)
    assert env.post("/_env/clock/advance", json={"sim_seconds": 5}, headers=H).status_code == 409
    assert env.post("/_env/start", headers=H).status_code == 409


def test_order_roundtrip_and_errors(clients):
    pub, env, _ = clients
    reset(env)
    r = pub.post("/api/orders", json={"ticker": "aapl", "side": "buy", "type": "market", "qty": 3})
    assert r.status_code == 200 and r.json()["status"] == "filled"
    r = pub.post("/api/orders", json={"ticker": "AAPL", "side": "buy", "type": "market", "qty": 0})
    assert r.json()["status"] == "rejected"
    assert (
        pub.post(
            "/api/orders", json={"ticker": "AAPL", "side": "long", "type": "market", "qty": 1}
        ).status_code
        == 422
    )
    r = pub.post("/api/orders", json={"ticker": "QQQQ", "side": "buy", "type": "market", "qty": 1})
    assert r.status_code == 404 and "Unknown symbol" in r.json()["detail"]
    assert pub.get("/api/positions").json()[0]["qty"] == 3
    actions = env.get("/_env/trace", headers=H).json()["actions"]
    assert [a["endpoint"] for a in actions].count("POST /api/orders") == 3


def test_watchlist_alert_prefs_endpoints(clients):
    pub, env, _ = clients
    reset(env)
    [default] = pub.get("/api/watchlists").json()
    assert len(default["tickers"]) == 6
    w = pub.post("/api/watchlists", json={"name": "Tech"}).json()
    assert pub.post("/api/watchlists", json={"name": "tech"}).status_code == 409
    for t in ("AAPL", "MSFT"):
        pub.post(f"/api/watchlists/{w['id']}/items", json={"ticker": t})
    assert pub.post(f"/api/watchlists/{w['id']}/items", json={"ticker": "AAPL"}).status_code == 409
    w = pub.delete(f"/api/watchlists/{w['id']}/items/MSFT").json()
    assert w["tickers"] == ["AAPL"]
    assert pub.patch(f"/api/watchlists/{w['id']}", json={"name": "Mega"}).json()["name"] == "Mega"
    a = pub.post(
        "/api/alerts", json={"ticker": "V", "condition": "crossing_up", "price": 999.5}
    ).json()
    assert a["status"] == "active" and a["price"] == 999.5
    assert (
        pub.patch(f"/api/alerts/{a['id']}", json={"enabled": False}).json()["status"] == "disabled"
    )
    p = pub.put(
        "/api/chart_prefs/AAPL",
        json={"timeframe": "15m", "indicators": [{"type": "sma", "period": 20}]},
    )
    assert p.json() == {
        "ticker": "AAPL",
        "timeframe": "15m",
        "indicators": [{"type": "sma", "period": 20}],
    }
    assert (
        pub.put("/api/chart_prefs/AAPL", json={"timeframe": "2m", "indicators": []}).status_code
        == 422
    )
    assert (
        pub.put("/api/ui_state", json={"active_symbol": "nvda"}).json()["active_symbol"] == "NVDA"
    )
    s = pub.get(
        "/api/screener", params={"sector": "Energy", "sort": "change_pct", "order": "desc"}
    ).json()
    assert len(s) == 4 and [r["change_pct"] for r in s] == sorted(
        (r["change_pct"] for r in s), reverse=True
    )


def all_public_gets(pub) -> dict:
    out = {}
    for path in [
        "/api/config",
        "/api/clock",
        "/api/symbols",
        "/api/quotes",
        "/api/screener",
        "/api/account",
        "/api/positions",
        "/api/orders",
        "/api/trades",
        "/api/watchlists",
        "/api/alerts",
        "/api/alerts/log",
        "/api/ui_state",
        "/api/chart_prefs/AAPL",
        "/api/quotes/AAPL",
    ]:
        r = pub.get(path)
        assert r.status_code == 200, path
        out[path] = r.json()
    for tf in ("1m", "5m", "15m", "1h", "1D"):
        for s in ("AAPL", "XOM"):
            out[f"bars/{s}/{tf}"] = pub.get(f"/api/bars/{s}", params={"tf": tf}).json()
    return out


@pytest.mark.parametrize(
    "t", [0, 1, 59, 60, 3599, 3661, 14_400, SESSION_SECONDS - 1, SESSION_SECONDS]
)
def test_no_future_data_in_public_responses(clients, t):
    pub, env, holder = clients
    reset(env)
    if t:
        env.post("/_env/clock/advance", json={"sim_seconds": t}, headers=H)
    e = holder.episode
    i = min(t, SESSION_SECONDS - 1)
    resp = all_public_gets(pub)
    blob = json.dumps(resp).lower()
    for word in FORBIDDEN:
        assert word not in blob, word
    for sym in ("AAPL", "XOM"):
        sid = e.world.by_ticker[sym].id
        path, vol = e.world.px[sid - 1], e.world.vol[sid - 1]
        for tf, width in (("1m", 60), ("5m", 300), ("15m", 900), ("1h", 3600)):
            all_bars = resp[f"bars/{sym}/{tf}"]["bars"]
            assert all(b["time"] <= sim_epoch(i) for b in all_bars)
            assert [b["time"] for b in all_bars] == sorted({b["time"] for b in all_bars})
            history = [b for b in all_bars if b["date"] != SESSION_DATE]
            bars = [b for b in all_bars if b["date"] == SESSION_DATE]
            assert all(b["date"] < SESSION_DATE for b in history)
            per_session = -(-SESSION_SECONDS // width)  # ceil: 1h has a final 30-minute bar
            assert len(history) == HISTORY_SESSIONS[tf] * per_session
            assert all_bars[: len(history)] == history  # history first, then today
            assert len(bars) == i // width + 1
            assert bars[-1]["c"] == cents_to_usd(path[i])
            # forming bar equals an independent aggregation of path[a..i]
            a = (i // width) * width
            assert bars[-1]["h"] == cents_to_usd(max(path[a : i + 1]))
            assert bars[-1]["v"] == sum(vol[a : i + 1])
            assert sum(b["v"] for b in bars) == sum(vol[: i + 1])
        daily = resp[f"bars/{sym}/1D"]["bars"]
        assert len(daily) == 61 and daily[-1]["c"] == cents_to_usd(path[i])
    q = {r["ticker"]: r for r in resp["/api/quotes"]}
    sid = e.world.by_ticker["AAPL"].id
    assert q["AAPL"]["last"] == cents_to_usd(e.world.px[sid - 1][i])
    assert q["AAPL"]["volume"] == sum(e.world.vol[sid - 1][: i + 1])


def test_websocket_frames_are_present_only(clients):
    pub, env, holder = clients
    reset(env)
    env.post("/_env/clock/advance", json={"sim_seconds": 600}, headers=H)
    pub.post("/api/orders", json={"ticker": "AAPL", "side": "buy", "type": "market", "qty": 1})
    with pub.websocket_connect("/ws") as ws:
        ws.send_json({"subscribe": {"ticker": "AAPL", "tf": "1m"}})
        frames = [ws.receive_json() for _ in range(2)]
    blob = json.dumps(frames).lower()
    for word in FORBIDDEN:
        assert word not in blob
    events = [f for f in frames if f["type"] == "event"]
    assert events and events[0]["event"]["type"] == "order_filled"
    tick = next(f for f in frames if f["type"] == "tick")
    assert tick["clock"]["sim_now"] == 600
    sid = holder.episode.world.by_ticker["AAPL"].id
    last = {q["ticker"]: q for q in tick["quotes"]}["AAPL"]["last"]
    assert last == cents_to_usd(holder.episode.world.px[sid - 1][600])
