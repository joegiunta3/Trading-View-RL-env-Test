"""Prior-session history: 60 sessions of 1-minute bars; daily bars derived from them."""

import pytest

from app.world.daily import MARKET_HOLIDAYS, SESSION_MINUTES, prior_dates
from app.world.generate import build_world

SEEDS = [1, 1234]


@pytest.fixture(params=SEEDS)
def world(request):
    return build_world(request.param)


def test_sessions_cover_the_60_prior_weekdays(world):
    dates = prior_dates()
    assert len(dates) == 60 and dates[-1] == "2026-01-14"
    assert not MARKET_HOLIDAYS & set(dates)
    for hist in world.history:
        assert [s.date for s in hist] == dates
        assert all(len(s.minutes) == SESSION_MINUTES for s in hist)


def test_minute_bars_are_well_formed_and_continuous(world):
    for hist in world.history:
        for sess in hist:
            prev_c = None
            for o, h, lo, c, v in sess.minutes:
                assert lo <= min(o, c) and h >= max(o, c) and lo > 0 and v >= 0
                if prev_c is not None:
                    assert o == prev_c
                prev_c = c


def test_daily_bars_equal_aggregated_minutes(world):
    for hist, daily in zip(world.history, world.daily, strict=True):
        for sess, d in zip(hist, daily, strict=True):
            m = sess.minutes
            assert (d.date, d.o, d.h, d.l, d.c, d.v) == (
                sess.date,
                m[0][0],
                max(b[1] for b in m),
                min(b[2] for b in m),
                m[-1][3],
                sum(b[4] for b in m),
            )


def test_today_opens_near_prior_close_except_gap(world):
    gap = world.truth["roles"]["gap"]
    for s in world.symbols:
        prior_close = world.daily[s.id - 1][-1].c
        move = abs(world.px[s.id - 1][0] - prior_close) / prior_close
        assert (0.03 <= move <= 0.04) if s.ticker == gap else move <= 0.0081


@pytest.mark.parametrize("t", [0, 59, 61, 3600, 26999, 27000])
def test_live_tail_matches_full_series(t):
    from app.market import market_for_seed

    m = market_for_seed(1234)
    for tf in ("1m", "5m", "15m", "1h", "1D"):
        assert m.bars(3, tf, t, last=2) == m.bars(3, tf, t)[-2:]
