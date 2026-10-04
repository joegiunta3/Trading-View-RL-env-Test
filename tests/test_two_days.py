"""The two-day episode: day 1 close, the after-hours break, day 2 open, and episode end."""

import pytest

from app.config import SESSION_SECONDS
from app.timeline import DAY_START, EPISODE_END, fmt_ts, phase, trade_index
from app.timeutil import cents_to_usd
from tests.conftest import make_episode, order, raises_engine

D2 = DAY_START[1]  # 27270 = Jan 16 09:00:00


def test_timeline_constants():
    assert (SESSION_SECONDS, D2, EPISODE_END) == (27_000, 27_270, 54_270)
    assert phase(26_999) == "open" and phase(27_000) == "after_hours" and phase(D2) == "open"
    assert phase(EPISODE_END) == "closed"
    assert trade_index(27_000) == trade_index(D2 - 1) == 26_999  # break shows day 1's close
    assert trade_index(D2) == 27_000
    assert fmt_ts(0) == "Jan 15 09:00:00" and fmt_ts(D2 + 3661) == "Jan 16 10:01:01"


def test_break_clock_view_counts_down_in_real_seconds():
    e = make_episode(start_time="16:29")
    e.advance(60)
    v = e.clock_view()
    assert (v["market_status"], v["day"], v["time"], v["next_open"]) == (
        "after-hours",
        1,
        "16:30:00",
        "Jan 16 09:00:00",
    )
    assert v["next_open_in"] == 45
    e.advance(135)
    assert e.clock_view()["next_open_in"] == 23  # ceil(135 / 6)
    e.advance(135)
    v = e.clock_view()
    assert (v["market_status"], v["day"], v["date"], v["time"]) == (
        "open",
        2,
        "2026-01-16",
        "09:00:00",
    )


def test_positions_and_cash_carry_over_day_orders_expire():
    e = make_episode(start_time="16:00")
    filled = order(e, "AAPL", "buy", "market", 10)
    working = order(e, "MSFT", "buy", "limit", 1, limit_price=1.00)
    cash_before = e.account_summary()["cash"]
    e.advance(D2 - e.now)
    assert e.positions()[0]["ticker"] == "AAPL" and e.positions()[0]["qty"] == 10
    assert e.account_summary()["cash"] == cash_before
    statuses = {o["id"]: o for o in e.list_orders()}
    assert statuses[filled["id"]]["status"] == "filled"
    assert statuses[working["id"]]["status"] == "cancelled"
    assert statuses[working["id"]]["closed_sim_ts"] == SESSION_SECONDS


def test_trading_blocked_during_break_but_alerts_allowed():
    e = make_episode(start_time="16:29")
    e.advance(100)
    raises_engine(order, e, "AAPL", "buy", "market", 1, status=409, match="Jan 16 09:00:00")
    a = e.create_alert("AAPL", "above", 1.00)
    assert a["created_sim_ts"] == e.now
    e.advance(D2 - e.now)
    assert e.list_alerts()[0]["triggered_sim_ts"] == D2  # first day-2 second
    assert e.list_alerts()[0]["triggered_time"] == "Jan 16 09:00:00"


def test_day2_quotes_use_day1_close_and_nothing_leaks_during_break():
    e = make_episode(start_time="16:29")
    sid = e.world.by_ticker["XOM"].id
    day1_close = e.world.px[sid - 1][SESSION_SECONDS - 1]
    day2_open = e.world.px[sid - 1][SESSION_SECONDS]
    e.advance(200)  # in the break
    q = e.quote("XOM")
    assert q["last"] == cents_to_usd(day1_close)
    for tf in ("1m", "5m", "1h", "1D"):
        assert all(b["date"] <= "2026-01-15" for b in e.bars("XOM", tf))
    e.advance(D2 - e.now)
    q = e.quote("XOM")
    assert q["prev_close"] == cents_to_usd(day1_close)
    assert q["last"] == q["open"] == cents_to_usd(day2_open)
    assert q["volume"] == e.world.vol[sid - 1][SESSION_SECONDS]


@pytest.mark.parametrize("tf,width", [("1m", 60), ("5m", 300), ("15m", 900), ("1h", 3600)])
def test_day1_becomes_history_on_day2(tf, width):
    e = make_episode(start_day=2, start_time="10:00")
    bars = e.bars("AAPL", tf)
    day1 = [b for b in bars if b["date"] == "2026-01-15"]
    day2 = [b for b in bars if b["date"] == "2026-01-16"]
    assert len(day1) == -(-SESSION_SECONDS // width)  # every day-1 bar, complete
    assert len(day2) == 3600 // width + 1
    assert bars.index(day1[0]) < bars.index(day2[0])
    daily = e.bars("AAPL", "1D")
    assert [b["date"] for b in daily[-2:]] == ["2026-01-15", "2026-01-16"]


def test_start_on_day_two_and_invalid_starts():
    e = make_episode(start_day=2, start_time="09:30")
    assert e.now == D2 + 1800 and e.clock_view()["day"] == 2
    for kwargs in ({"start_day": 3}, {"start_time": "16:30"}, {"start_time": "08:00"}):
        raises_engine(make_episode, status=422, **kwargs)


def test_episode_end_closes_day_two():
    e = make_episode(start_day=2, start_time="16:00")
    order(e, "GS", "buy", "limit", 1, limit_price=1.00)
    e.advance(5000)
    assert e.clock_view()["market_status"] == "closed"
    last = e.events_since(0)[-1]
    assert (last["type"], last["day"], last["final"]) == ("session_closed", 2, True)
    assert e.list_orders()[0]["status"] == "cancelled"
