"""Server-authoritative sim clock with realtime and fixed-step modes."""

import time
from collections.abc import Callable
from enum import StrEnum

from app.config import TIME_SCALE
from app.timeline import EPISODE_END, is_trading_second


class ClockMode(StrEnum):
    REALTIME = "realtime"
    FIXED_STEP = "fixed-step"


class ClockState(StrEnum):
    READY = "ready"  # reset, not started; frozen at start_sec
    RUNNING = "running"  # includes the after-hours break between the two days
    CLOSED = "closed"  # reached day 2's 16:30:00 close; frozen


class ClockError(Exception):
    pass


class SimClock:
    """sim_now in integer episode seconds (see app/timeline.py).

    realtime: start_sec + floor(monotonic elapsed * TIME_SCALE), capped at the episode end.
    fixed-step: changes only through advance(). `monotonic` is injectable for tests.
    """

    def __init__(
        self,
        mode: ClockMode,
        start_sec: int,
        monotonic: Callable[[], float] = time.monotonic,
        scale: int = TIME_SCALE,
    ):
        if not is_trading_second(start_sec):
            raise ClockError(
                "start time must be during a session (09:00:00 to 16:29:59 on day 1 or 2)"
            )
        self.mode = ClockMode(mode)
        self.start_sec = start_sec
        self._monotonic = monotonic
        self._scale = scale
        self._started = False
        self._mono0 = 0.0
        self._fixed_now = start_sec

    @property
    def now(self) -> int:
        if not self._started:
            return self.start_sec
        if self.mode is ClockMode.FIXED_STEP:
            return self._fixed_now
        elapsed = self._monotonic() - self._mono0
        return min(self.start_sec + int(elapsed * self._scale), EPISODE_END)

    @property
    def state(self) -> ClockState:
        if not self._started:
            return ClockState.READY
        return ClockState.CLOSED if self.now >= EPISODE_END else ClockState.RUNNING

    def start(self) -> None:
        if self._started:
            raise ClockError("Clock already started")
        self._started = True
        self._mono0 = self._monotonic()

    def advance(self, sim_seconds: int) -> int:
        if self.mode is not ClockMode.FIXED_STEP:
            raise ClockError("advance is only available in fixed-step mode")
        if not self._started:
            raise ClockError("Clock not started")
        if not isinstance(sim_seconds, int) or isinstance(sim_seconds, bool) or sim_seconds <= 0:
            raise ClockError("sim_seconds must be a positive integer")
        self._fixed_now = min(self._fixed_now + sim_seconds, EPISODE_END)
        return self._fixed_now
