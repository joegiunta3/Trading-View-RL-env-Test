"""Planted scenarios: overlays on base paths, plus measurement from the final integer path.

Every fact recorded in world_truth is measured from the final cent-rounded path, never
taken from the intended overlay parameters.
"""

from collections import deque

from app.timeutil import parse_hhmm
from app.world.daily import to_cents

T_1300 = parse_hhmm("13:00")
T_1400 = parse_hhmm("14:00")
T_1200 = parse_hhmm("12:00")

# Scenario time windows (inclusive), chosen so each matches the SPEC §10 tasks that use it.
WINDOWS = {
    "breakout": ("10:00", "11:30"),
    "sharp_drop": ("10:30", "12:30"),
    "fakeout": ("11:15", "13:00"),
    "volume_surge": ("13:10", "13:40"),
    "spike": ("11:00", "11:30"),
}

BREAKOUT_APPROACH = 600
BREAKOUT_RUN = 1200
DROP_LEN = 480
DROP_WINDOW = 600
FAKEOUT_APPROACH = 1200
FAKEOUT_REBOUND = 900
FAKEOUT_CLAMP = 1800
SURGE_LEN = 900
SPIKE_DOWN = 180
SPIKE_UP = 600

OTHER_DRAWDOWN_LIMIT_PCT = 4  # no non-drop ticker may fall this much within 10 minutes


class ScenarioError(Exception):
    """A planted-scenario invariant failed; the generator retries with the next attempt."""


def round_path(px: list[float]) -> list[int]:
    return [to_cents(x) for x in px]


def pct(a: int, b: int) -> float:
    return round((a - b) / b, 6)


# --- overlays -------------------------------------------------------------------------


def plant_breakout(base: list[float], t1: int, h: int) -> list[int]:
    """Stay below the prior-day high H until t1, cross it exactly at t1, then run ~+5.5%.

    Raises ScenarioError if the morning already trades too close to H; the caller then
    regenerates this ticker's base path with the next seeded sub-attempt.
    """
    a0 = t1 - BREAKOUT_APPROACH
    level = h / 100.0
    if max(base[:a0]) >= level * 0.996:
        raise ScenarioError("morning trades too close to the prior-day high")
    r = level * 0.997 / base[t1 - 1]
    f = list(base)
    for s in range(a0, t1):
        w = (s - a0) / BREAKOUT_APPROACH
        f[s] = base[s] * (1.0 + w * (r - 1.0))
    pre = round_path(f[:t1])
    if max(pre) >= h:
        raise ScenarioError("approach crossed the prior-day high early")
    first = max(to_cents(level * 1.002), h + 1)
    c = (first / 100.0) / base[t1]
    post = []
    for s in range(t1, len(base)):
        ramp = min(1.0, (s - t1) / BREAKOUT_RUN)
        post.append(to_cents(base[s] * c * (1.0 + 0.055 * ramp)))
    return pre + post


def plant_sharp_drop(base: list[float], t2: int) -> list[float]:
    f = list(base)
    for s in range(t2, len(base)):
        f[s] = base[s] * (1.0 - 0.065 * min(1.0, (s - t2) / DROP_LEN))
    return f


def fakeout_level(price: float) -> int:
    """Round level (cents) ~1.5%+ below price: whole dollars, or half dollars under $60."""
    target = price * 0.985
    step = 1.0 if price >= 60 else 0.5
    return to_cents(int(target / step) * step)


def plant_fakeout(base: list[float], t3: int) -> tuple[list[int], int]:
    """Dip that touches round level R exactly once at t3, then rebounds ~3%."""
    level = fakeout_level(base[t3 - FAKEOUT_APPROACH])
    k = (level / 100.0) / base[t3]
    f = list(base)
    a0 = t3 - FAKEOUT_APPROACH
    for s in range(a0, t3):
        w = (s - a0) / FAKEOUT_APPROACH
        f[s] = base[s] * (1.0 + w * (k - 1.0))
    for s in range(t3, len(base)):
        f[s] = base[s] * k * (1.0 + 0.03 * min(1.0, (s - t3) / FAKEOUT_REBOUND))
    out = round_path(f)
    for s in range(t3 - FAKEOUT_CLAMP, min(len(out), t3 + FAKEOUT_CLAMP + 1)):
        if s != t3 and out[s] <= level:
            out[s] = level + 1
    out[t3] = level
    return out, level


def plant_flat_hour(base: list[float]) -> list[float]:
    """Damp price moves 13:00-14:00 to ~12% of normal, staying continuous afterwards."""
    f = list(base)
    anchor = base[T_1300]
    for s in range(T_1300, T_1400):
        f[s] = anchor * (1.0 + 0.12 * (base[s] / anchor - 1.0))
    k = anchor * (1.0 + 0.12 * (base[T_1400] / anchor - 1.0)) / base[T_1400]
    for s in range(T_1400, len(base)):
        f[s] = base[s] * k
    return f


def plant_spike(base: list[float], start: int) -> list[float]:
    """-3% flash dip over 3 min, linear recovery over the next 10 min."""
    f = list(base)
    for s in range(start, start + SPIKE_DOWN + SPIKE_UP):
        if s < start + SPIKE_DOWN:
            g = 1.0 - 0.03 * (s - start) / SPIKE_DOWN
        else:
            g = 1.0 - 0.03 * (1.0 - (s - start - SPIKE_DOWN) / SPIKE_UP)
        f[s] = base[s] * g
    return f


def scale_volume(vol: list[float], a: int, b: int, factor: float) -> None:
    for s in range(a, min(b, len(vol))):
        vol[s] *= factor


# --- measurement ----------------------------------------------------------------------


def max_drawdown_pct_window(path: list[int], window: int) -> float:
    """Largest fall from a running max within `window` seconds, as a fraction."""
    dq: deque[int] = deque()
    worst = 0.0
    for s, p in enumerate(path):
        while dq and dq[0] < s - window:
            dq.popleft()
        while dq and path[dq[-1]] <= p:
            dq.pop()
        dq.append(s)
        peak = path[dq[0]]
        dd = (peak - p) / peak
        if dd > worst:
            worst = dd
    return worst


def hour_stats(path: list[int], vol: list[int], a: int, b: int) -> tuple[float, int]:
    seg = path[a:b]
    return (max(seg) - min(seg)) / seg[0], sum(vol[a:b])


def measure_breakout(path: list[int], h: int, t1: int) -> dict:
    if any(p >= h for p in path[:t1]) or path[t1] < h:
        raise ScenarioError("breakout does not first cross H at T1")
    run_max = max(path[t1 : t1 + BREAKOUT_RUN + 1])
    if run_max * 100 < h * 104:
        raise ScenarioError("breakout run < 4%")
    return {"prior_day_high_cents": h, "run_max_cents": run_max, "run_pct": pct(run_max, h)}


def measure_sharp_drop(path: list[int], t2: int) -> dict:
    start = path[t2]
    seg = path[t2 : t2 + DROP_WINDOW + 1]
    low = min(seg)
    if low * 100 > start * 95:
        raise ScenarioError("sharp drop < 5% within 10 minutes")
    return {
        "start_price_cents": start,
        "low_10m_cents": low,
        "low_10m_sec": t2 + seg.index(low),
        "drop_pct": pct(low, start),
    }


def measure_fakeout(path: list[int], level: int, t3: int) -> dict:
    lo, hi = t3 - FAKEOUT_CLAMP, min(len(path), t3 + FAKEOUT_CLAMP + 1)
    if path[t3] != level or any(path[s] <= level for s in range(lo, hi) if s != t3):
        raise ScenarioError("fake-out does not touch level exactly once")
    rebound = max(path[t3 : t3 + FAKEOUT_REBOUND + 1])
    if rebound * 1000 < level * 1015:
        raise ScenarioError("fake-out rebound < 1.5%")
    return {"level_cents": level, "rebound_max_cents": rebound, "rebound_pct": pct(rebound, level)}


def measure_spike(path: list[int], start: int) -> dict:
    pre = path[start - 1]
    seg = path[start : start + SPIKE_DOWN + SPIKE_UP + 1]
    bottom = min(seg)
    bottom_sec = start + seg.index(bottom)
    end_px = path[start + SPIKE_DOWN + SPIKE_UP]
    if bottom * 1000 > pre * 975:
        raise ScenarioError("spike dip < 2.5%")
    if end_px * 100 < bottom * 102:
        raise ScenarioError("spike did not revert")
    if start + SPIKE_DOWN + SPIKE_UP >= T_1200:
        raise ScenarioError("spike reversal not complete before 12:00")
    return {
        "pre_price_cents": pre,
        "bottom_cents": bottom,
        "bottom_sec": bottom_sec,
        "reverted_price_cents": end_px,
        "reverted_sec": start + SPIKE_DOWN + SPIKE_UP,
    }
