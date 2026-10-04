"""Conversions between wall-style session times and sim seconds (0 = 09:00:00)."""

from datetime import UTC, date, datetime

from app.config import SESSION_DATE, SESSION_SECONDS

_OPEN_SEC_OF_DAY = 9 * 3600
SESSION_EPOCH = int(
    datetime.fromisoformat(f"{SESSION_DATE}T09:00:00").replace(tzinfo=UTC).timestamp()
)


def parse_hhmm(text: str) -> int:
    """Parse 'HH:MM' or 'HH:MM:SS' into sim seconds since 09:00:00."""
    parts = text.strip().split(":")
    if len(parts) not in (2, 3) or not all(p.isdigit() for p in parts):
        raise ValueError(f"Invalid time {text!r}; expected HH:MM or HH:MM:SS")
    h, m = int(parts[0]), int(parts[1])
    s = int(parts[2]) if len(parts) == 3 else 0
    if m > 59 or s > 59:
        raise ValueError(f"Invalid time {text!r}")
    sec = h * 3600 + m * 60 + s - _OPEN_SEC_OF_DAY
    if not 0 <= sec <= SESSION_SECONDS:
        raise ValueError(f"Time {text!r} is outside the 09:00-16:30 session")
    return sec


def fmt_hhmmss(sim_sec: int) -> str:
    t = sim_sec + _OPEN_SEC_OF_DAY
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def sim_epoch(sim_sec: int) -> int:
    """Unix-style timestamp (UTC-labelled) for a sim second, for chart axes."""
    return SESSION_EPOCH + sim_sec


def date_epoch(iso_date: str) -> int:
    return int(datetime.combine(date.fromisoformat(iso_date), datetime.min.time(), UTC).timestamp())


def cents_to_usd(cents: int) -> float:
    return round(cents / 100, 2)


def usd_to_cents(usd: float) -> int:
    """Convert a dollar amount to integer cents; rejects sub-cent precision."""
    cents = round(usd * 100)
    if abs(cents - usd * 100) > 1e-6:
        raise ValueError("Prices must have at most 2 decimal places")
    return int(cents)
