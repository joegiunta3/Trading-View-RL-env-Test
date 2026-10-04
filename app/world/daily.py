"""Prior daily bars (60 sessions before SESSION_DATE)."""

import random
from dataclasses import dataclass
from datetime import date, timedelta

from app.config import PRIOR_DAILY_BARS, SESSION_DATE
from app.rng import std_normal


@dataclass(frozen=True)
class DailyBar:
    date: str
    o: int  # cents
    h: int
    l: int  # noqa: E741
    c: int
    v: int


def to_cents(x: float) -> int:
    return int(x * 100 + 0.5)


def prior_dates(n: int = PRIOR_DAILY_BARS) -> list[str]:
    """The n weekdays immediately before SESSION_DATE, oldest first."""
    d = date.fromisoformat(SESSION_DATE)
    out: list[str] = []
    while len(out) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out[::-1]


def gen_daily(
    rng: random.Random, start_px: float, daily_vol: float, base_volume: int
) -> list[DailyBar]:
    bars: list[DailyBar] = []
    close = start_px
    for d in prior_dates():
        o = close * (1 + daily_vol * 0.3 * std_normal(rng))
        c = o * (1 + daily_vol * std_normal(rng))
        h = max(o, c) * (1 + daily_vol * 0.5 * rng.random())
        lo = min(o, c) * (1 - daily_vol * 0.5 * rng.random())
        v = int(base_volume * (0.7 + 0.6 * rng.random()))
        bars.append(DailyBar(d, to_cents(o), to_cents(h), to_cents(lo), to_cents(c), v))
        close = c
    return bars
