"""Global constants. APP_NAME lives here and nowhere else in the backend."""

import os
from pathlib import Path

APP_NAME = "chartview"

# Every episode is two simulated trading days, each 09:00:00 to 16:30:00, separated by a
# short after-hours break. See app/timeline.py for the episode-second timeline.
SESSION_DATES = ("2026-01-15", "2026-01-16")
SESSION_DATE = SESSION_DATES[0]  # first day; history covers the sessions before it
SESSION_OPEN_HHMMSS = "09:00:00"
SESSION_SECONDS = 27_000  # per day: seconds 0..26999 are tradable; 27000 is the close
TIME_SCALE = 6  # sim seconds per real second
BREAK_SECONDS = 270  # after-hours break between days, in sim seconds (= 45 real seconds)

PRIOR_DAILY_BARS = 60
START_CASH_CENTS = 10_000_000  # $100,000.00
DUPLICATE_ORDER_WINDOW_SEC = 5

PUBLIC_PORT = int(os.environ.get("CHARTVIEW_PUBLIC_PORT", "8080"))
ENV_PORT = int(os.environ.get("CHARTVIEW_ENV_PORT", "9090"))
ENV_TOKEN_VAR = "CHARTVIEW_ENV_TOKEN"
ENV_TOKEN_HEADER = "X-Env-Token"

# How many seeds' worlds stay cached in memory (each ~100 MB incl. DB template).
SEED_CACHE = int(os.environ.get("CHARTVIEW_SEED_CACHE", "4"))

DATA_DIR = Path(os.environ.get("CHARTVIEW_DATA_DIR", "data"))

FRONTEND_DIST = Path(
    os.environ.get(
        "CHARTVIEW_FRONTEND_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"
    )
)
