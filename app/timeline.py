"""The episode timeline: two trading days separated by an after-hours break.

All `sim_ts` values (clock, orders, trades, alerts, action log) are **episode seconds**,
counted from day 1 09:00:00 and increasing monotonically:

    [0, 27000)                 day 1 trading      (Jan 15, 09:00:00 .. 16:29:59)
    27000 .. 27269             after-hours break  (day 1 has closed; day 2 not yet open)
    [27270, 54270)             day 2 trading      (Jan 16, 09:00:00 .. 16:29:59)
    54270                      end of episode     (day 2 close)

Price paths are indexed by **trading index** k = day * 27000 + second-of-day (0..53999).
"""

from app.config import BREAK_SECONDS, SESSION_DATES, SESSION_SECONDS
from app.timeutil import fmt_hhmmss, parse_hhmm

DAYS = len(SESSION_DATES)
DAY_START = tuple(d * (SESSION_SECONDS + BREAK_SECONDS) for d in range(DAYS))  # (0, 27270)
EPISODE_END = DAY_START[-1] + SESSION_SECONDS  # 54270
TRADING_SECONDS = DAYS * SESSION_SECONDS  # 54000

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def day_of(t: int) -> int:
    """0-based day whose session is current or most recently closed at episode second t."""
    for d in range(DAYS - 1, -1, -1):
        if t >= DAY_START[d]:
            return d
    return 0


def second_of_day(t: int) -> int:
    """Seconds since 09:00 on day_of(t), capped at the close (27000) for breaks and the end."""
    return min(t - DAY_START[day_of(t)], SESSION_SECONDS)


def phase(t: int) -> str:
    """ "open" while a session trades, "after_hours" in the break, "closed" at the very end."""
    if t >= EPISODE_END:
        return "closed"
    return "open" if t - DAY_START[day_of(t)] < SESSION_SECONDS else "after_hours"


def trade_index(t: int) -> int:
    """Index of the latest revealed trading second at episode second t (never in the future)."""
    return day_of(t) * SESSION_SECONDS + min(second_of_day(t), SESSION_SECONDS - 1)


def is_trading_second(t: int) -> bool:
    return 0 <= t < EPISODE_END and phase(t) == "open"


def to_ts(day: int, sec: int) -> int:
    """Episode second for (0-based day, seconds since 09:00)."""
    return DAY_START[day] + sec


def next_open(t: int) -> int | None:
    """Episode second of the next session open after a close, or None if none remains."""
    d = day_of(t) + 1
    return DAY_START[d] if d < DAYS else None


def parse_day_time(text: str, day: int = 1) -> int:
    """'HH:MM[:SS]' on 1-based `day` -> episode second (16:30 allowed only as a close)."""
    if not 1 <= day <= DAYS:
        raise ValueError(f"day must be between 1 and {DAYS}")
    return to_ts(day - 1, parse_hhmm(text))


def fmt_ts(t: int | None) -> str | None:
    """Episode second -> 'Jan 16 10:05:00' (None stays None)."""
    if t is None:
        return None
    d = day_of(t)
    _, m, dd = SESSION_DATES[d].split("-")
    return f"{_MONTHS[int(m) - 1]} {int(dd)} {fmt_hhmmss(second_of_day(t))}"
