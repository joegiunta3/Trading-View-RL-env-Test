"""Seeded RNG streams. World generation must only use generators from here."""

import hashlib
import random


def derive_rng(seed: int, *labels: object) -> random.Random:
    """Independent, reproducible stream for (seed, labels); immune to PYTHONHASHSEED."""
    key = "|".join([str(seed), *(str(x) for x in labels)]).encode()
    return random.Random(int.from_bytes(hashlib.sha256(key).digest()[:8], "big"))


def std_normal(rng: random.Random) -> float:
    """Approximate N(0,1) using only +,-,* on uniforms (Irwin-Hall, n=4).

    Avoids libm transcendental functions so generated paths are bit-identical
    across platforms.
    """
    u = rng.random() + rng.random() + rng.random() + rng.random()
    return (u - 2.0) * 1.7320508075688772
