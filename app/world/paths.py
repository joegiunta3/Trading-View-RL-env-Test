"""Intraday 1-second price and volume paths: regime-switching walk + U-shaped volume."""

import random

from app.config import SESSION_SECONDS
from app.rng import std_normal

SQRT_SESSION = 164.31676725154983  # sqrt(27000)

# (name, drift in units of sigma, vol multiplier, volume multiplier)
REGIMES = (
    ("calm", 0.0, 0.6, 1.0),
    ("trend_up", 0.08, 1.0, 1.15),
    ("trend_down", -0.08, 1.0, 1.15),
    ("volatile", 0.0, 1.8, 1.5),
)


def next_regime(rng: random.Random) -> int:
    r = rng.random()
    if r < 0.4:
        return 0
    if r < 0.6:
        return 1
    if r < 0.8:
        return 2
    return 3


def volume_profile(s: int, n: int = SESSION_SECONDS) -> float:
    """U-shaped intraday profile with mean ~1 (quadratic, no transcendental functions)."""
    x = 2.0 * s / (n - 1) - 1.0
    return (0.6 + 2.4 * x * x) / 1.4


def gen_intraday(
    rng: random.Random, open_px: float, daily_vol: float, base_volume: int
) -> tuple[list[float], list[float]]:
    """Float price (dollars) and float volume per sim second, before scenario overlays."""
    n = SESSION_SECONDS
    sigma = daily_vol / SQRT_SESSION
    per_sec = base_volume / n
    px = [0.0] * n
    vol = [0.0] * n
    p = open_px
    regime = 0
    left = rng.randint(180, 1500)
    for s in range(n):
        if left == 0:
            regime = next_regime(rng)
            left = rng.randint(180, 1500)
        _, drift, vm, volm = REGIMES[regime]
        if s > 0:
            p = p * (1.0 + sigma * (drift + vm * std_normal(rng)))
        px[s] = p
        vol[s] = per_sec * volume_profile(s) * volm * (0.4 + 1.2 * rng.random())
        left -= 1
    return px, vol
