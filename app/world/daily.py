"""Prior history: PRIOR_DAILY_BARS sessions at 1-minute resolution before SESSION_DATE.

Daily bars are derived from the minute bars, so intraday and daily charts always agree.
"""

import random
from array import array
from dataclasses import dataclass
from datetime import date, timedelta

from app.config import PRIOR_DAILY_BARS, SESSION_DATE, SESSION_SECONDS
from app.rng import std_normal
from app.world.paths import REGIMES, next_regime, volume_profile

SESSION_MINUTES = SESSION_SECONDS // 60  # 450
SQRT_SESSION_MINUTES = 21.213203435596427  # sqrt(450)

MinuteBar = tuple[int, int, int, int, int]  # o, h, l, c (cents), v

# US market holidays inside the history window (no session on these weekdays).
MARKET_HOLIDAYS = frozenset({"2025-11-27", "2025-12-25", "2026-01-01"})


@dataclass(frozen=True)
class DailyBar:
    date: str
    o: int  # cents
    h: int
    l: int  # noqa: E741
    c: int
    v: int


@dataclass(frozen=True)
class Session:
    """One prior session. Minute bars are stored flat (o,h,l,c,v per minute) to save memory."""

    date: str
    flat: array  # array("q") of SESSION_MINUTES * 5 values, 09:00 .. 16:29

    @property
    def minutes(self) -> list[MinuteBar]:
        f = self.flat
        return [(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4]) for i in range(0, len(f), 5)]

    def daily(self) -> DailyBar:
        m = self.minutes
        return DailyBar(
            self.date,
            m[0][0],
            max(b[1] for b in m),
            min(b[2] for b in m),
            m[-1][3],
            sum(b[4] for b in m),
        )


def to_cents(x: float) -> int:
    return int(x * 100 + 0.5)


def prior_dates(n: int = PRIOR_DAILY_BARS) -> list[str]:
    """The n trading days (weekdays, excluding MARKET_HOLIDAYS) before SESSION_DATE, oldest first."""
    d = date.fromisoformat(SESSION_DATE)
    out: list[str] = []
    while len(out) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in MARKET_HOLIDAYS:
            out.append(d.isoformat())
    return out[::-1]


def gen_history(
    rng: random.Random, start_px: float, daily_vol: float, base_volume: int
) -> list[Session]:
    """Minute bars for each prior session: regime-switching walk, U-shaped volume.

    Each minute opens at the previous minute's close; each session opens with a small
    overnight move from the previous session's close.
    """
    sigma = daily_vol / SQRT_SESSION_MINUTES
    per_min = base_volume / SESSION_MINUTES
    sessions: list[Session] = []
    price = start_px
    regime, left = 0, rng.randint(5, 40)
    for d in prior_dates():
        price = price * (1.0 + daily_vol * 0.25 * std_normal(rng))
        prev_close = to_cents(price)
        flat = array("q")
        for m in range(SESSION_MINUTES):
            if left == 0:
                regime, left = next_regime(rng), rng.randint(5, 40)
            left -= 1
            _, drift, vm, volm = REGIMES[regime]
            price = price * (1.0 + sigma * (drift + vm * std_normal(rng)))
            o, c = prev_close, to_cents(price)
            h = max(o, c) + to_cents(max(o, c) / 100.0 * sigma * 0.4 * vm * rng.random())
            lo = min(o, c) - to_cents(min(o, c) / 100.0 * sigma * 0.4 * vm * rng.random())
            v = int(per_min * volume_profile(m * 60) * volm * (0.4 + 1.2 * rng.random()) + 0.5)
            flat.extend((o, h, lo, c, v))
            prev_close = c
        sessions.append(Session(d, flat))
    return sessions
