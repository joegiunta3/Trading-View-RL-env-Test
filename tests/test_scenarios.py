"""Planted scenarios, re-checked independently of app.world.scenarios on the final paths."""

import pytest

from app.timeutil import parse_hhmm
from app.world.generate import build_world

SEEDS = [1, 7, 42, 1234, 99999]


def path(w, ticker):
    return w.px[w.by_ticker[ticker].id - 1]


def vol(w, ticker):
    return w.vol[w.by_ticker[ticker].id - 1]


@pytest.fixture(params=SEEDS)
def world(request):
    return build_world(request.param)


def test_roles_distinct_and_times_in_windows(world):
    roles = world.truth["roles"]
    assert len(set(roles.values())) == 6
    sc = world.truth["scenarios"]
    for key, field, lo, hi in [
        ("breakout", "t1_sec", "10:00", "11:30"),
        ("sharp_drop", "t2_sec", "10:30", "12:30"),
        ("fakeout", "t3_sec", "11:15", "13:00"),
        ("volume_surge", "t4_sec", "13:10", "13:40"),
        ("spike", "start_sec", "11:00", "11:30"),
    ]:
        assert parse_hhmm(lo) <= sc[key][field] <= parse_hhmm(hi)


def test_gap(world):
    g = world.truth["scenarios"]["gap"]
    p = path(world, g["ticker"])
    prior = world.daily[world.by_ticker[g["ticker"]].id - 1][-1].c
    assert 0.03 <= abs(p[0] - prior) / prior <= 0.04


def test_breakout_crosses_prior_day_high_at_t1(world):
    b = world.truth["scenarios"]["breakout"]
    p = path(world, b["ticker"])
    h = world.daily[world.by_ticker[b["ticker"]].id - 1][-1].h
    t1 = b["t1_sec"]
    assert h == b["prior_day_high_cents"]
    assert max(p[:t1]) < h <= p[t1]
    assert max(p[t1 : t1 + 1201]) >= h * 1.04


def test_sharp_drop(world):
    d = world.truth["scenarios"]["sharp_drop"]
    p = path(world, d["ticker"])
    t2 = d["t2_sec"]
    assert min(p[t2 : t2 + 601]) <= p[t2] * 0.95


def test_fakeout_touches_round_level_once_then_reverses(world):
    f = world.truth["scenarios"]["fakeout"]
    p = path(world, f["ticker"])
    t3, level = f["t3_sec"], f["level_cents"]
    assert level % 50 == 0
    assert p[t3] == level
    assert all(p[s] > level for s in range(t3 - 1800, t3 + 1801) if s != t3)
    assert max(p[t3 : t3 + 901]) >= level * 1.015
    assert t3 > parse_hhmm("11:00")


def test_volume_surge_is_unique_flat_high_volume_hour(world):
    d = world.truth["scenarios"]["volume_surge"]["ticker"]
    a, b = parse_hhmm("13:00"), parse_hhmm("14:00")

    def stats(t):
        seg = path(world, t)[a:b]
        return (max(seg) - min(seg)) / seg[0], sum(vol(world, t)[a:b]) / sum(vol(world, t))

    d_range, d_share = stats(d)
    assert d_range <= 0.006
    for s in world.symbols:
        if s.ticker != d:
            r, share = stats(s.ticker)
            assert r > d_range and share < d_share


def test_spike_dips_and_reverts_before_noon(world):
    s = world.truth["scenarios"]["spike"]
    p = path(world, s["ticker"])
    start = s["start_sec"]
    pre = p[start - 1]
    low = min(p[start : start + 781])
    assert low <= pre * 0.975
    assert max(p[start + 600 : parse_hhmm("12:00")]) >= low * 1.02


def test_no_unplanned_sharp_drops(world):
    drop = world.truth["roles"]["sharp_drop"]
    for s in world.symbols:
        if s.ticker == drop:
            continue
        p = path(world, s.ticker)
        for i in range(600, len(p), 30):  # sampled 10-minute windows
            assert min(p[i - 600 : i + 1]) > max(p[i - 600 : i - 300]) * 0.96


def test_universe_shape(world):
    assert len(world.symbols) == 20
    sectors = {}
    for s in world.symbols:
        sectors.setdefault(s.sector, []).append(s.ticker)
        assert 1 <= s.spread <= 5
        assert len(world.daily[s.id - 1]) == 60
        assert len(world.px[s.id - 1]) == 27000
    assert sorted(len(v) for v in sectors.values()) == [4] * 5
