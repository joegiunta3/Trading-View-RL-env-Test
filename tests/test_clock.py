import pytest

from app.clock import ClockError, ClockMode, ClockState, SimClock
from app.config import SESSION_SECONDS
from app.timeutil import fmt_hhmmss, parse_hhmm
from tests.conftest import make_episode, order, raises_engine


class FakeMonotonic:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_time_parsing_roundtrip():
    assert parse_hhmm("09:00") == 0
    assert parse_hhmm("12:00") == 10800
    assert parse_hhmm("16:30:00") == SESSION_SECONDS
    assert fmt_hhmmss(10800 + 61) == "12:01:01"
    for bad in ("08:59", "16:31", "9", "12:60", "ab:cd"):
        with pytest.raises(ValueError):
            parse_hhmm(bad)


def test_fixed_step_frozen_until_advanced():
    c = SimClock(ClockMode.FIXED_STEP, 0)
    assert c.state is ClockState.READY and c.now == 0
    with pytest.raises(ClockError):
        c.advance(10)  # not started
    c.start()
    assert c.now == 0 and c.state is ClockState.RUNNING
    assert c.advance(30) == 30 and c.now == 30
    for bad in (0, -5, 1.5, True):
        with pytest.raises(ClockError):
            c.advance(bad)


def test_fixed_step_clamps_at_close():
    c = SimClock(ClockMode.FIXED_STEP, 26990)
    c.start()
    c.advance(1000)
    assert c.now == SESSION_SECONDS and c.state is ClockState.CLOSED


def test_realtime_scaling_with_fake_monotonic():
    mono = FakeMonotonic()
    c = SimClock(ClockMode.REALTIME, 0, monotonic=mono)
    mono.t += 50  # time before start does not count
    assert c.now == 0 and c.state is ClockState.READY
    c.start()
    mono.t += 10
    assert c.now == 60  # 10 real seconds = 60 sim seconds = one 1m bar
    mono.t += 0.1
    assert c.now == 60  # floor
    mono.t += 0.07
    assert c.now == 61
    mono.t += 10_000
    assert c.now == SESSION_SECONDS and c.state is ClockState.CLOSED


def test_realtime_rejects_advance():
    c = SimClock(ClockMode.REALTIME, 0, monotonic=FakeMonotonic())
    c.start()
    with pytest.raises(ClockError):
        c.advance(10)


def test_double_start_and_bad_start_time():
    c = SimClock(ClockMode.FIXED_STEP, 0)
    c.start()
    with pytest.raises(ClockError):
        c.start()
    with pytest.raises(ClockError):
        SimClock(ClockMode.FIXED_STEP, SESSION_SECONDS)


def test_episode_start_time_noon_has_morning_history():
    e = make_episode(start_time="12:00")
    assert e.now == 10800
    assert len(e.bars("AAPL", "1m")) == 181  # 09:00 .. 12:00 inclusive (12:00 forming)
    o = order(e, "AAPL", "buy", "market", 1)
    assert o["filled_sim_ts"] == 10800


def test_episode_realtime_advance_rejected():
    e = make_episode()
    e2 = type(e)(1234, clock_mode="realtime")
    e2.start()
    raises_engine(e2.advance, 10, status=409, match="fixed-step")


def test_orders_blocked_before_start_and_after_close():
    e = make_episode(start=False)
    raises_engine(order, e, "AAPL", "buy", "market", 1, status=409, match="not open")
    e.start()
    e.advance(SESSION_SECONDS)
    assert e.clock_view()["market_status"] == "closed"
    raises_engine(order, e, "AAPL", "buy", "market", 1, status=409, match="Session closed")
    raises_engine(e.create_alert, "AAPL", "above", 1.0, status=409)


def test_close_cancels_working_orders_and_logs():
    e = make_episode()
    o = order(e, "AAPL", "buy", "limit", 1, limit_price=1.00)
    assert o["status"] == "working"
    e.advance(SESSION_SECONDS)
    orders = {x["id"]: x for x in e.list_orders()}
    assert orders[o["id"]]["status"] == "cancelled"
    assert orders[o["id"]]["closed_sim_ts"] == SESSION_SECONDS
    assert "expired at close" in orders[o["id"]]["reason"]
    endpoints = [a["endpoint"] for a in e.trace()]
    assert "engine:expire" in endpoints and endpoints[-1] == "engine:session_closed"
    assert [ev["type"] for ev in e.events_since(0)][-1] == "session_closed"
