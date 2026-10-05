"""Technical indicators on bar series. The frontend (src/indicators.ts) uses the same formulas;
graders and task writers use these via POST /_env/indicators.

Each function takes bars as dicts with o/h/l/c/v (dollars) and `date`, and returns one value (or
None while there is not enough history) per bar.
"""

from collections.abc import Sequence

Bars = Sequence[dict]
Series = list[float | None]


def _round(x: float | None, nd: int = 4) -> float | None:
    return None if x is None else round(x, nd)


def sma(values: Sequence[float], n: int) -> Series:
    out: Series = [None] * len(values)
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= n:
            total -= values[i - n]
        if i >= n - 1:
            out[i] = total / n
    return out


def ema(values: Sequence[float | None], n: int) -> Series:
    """EMA seeded with the SMA of the first n available values (None values are skipped)."""
    out: Series = [None] * len(values)
    alpha = 2 / (n + 1)
    seed: list[float] = []
    prev: float | None = None
    for i, v in enumerate(values):
        if v is None:
            continue
        if prev is None:
            seed.append(v)
            if len(seed) == n:
                prev = sum(seed) / n
                out[i] = prev
            continue
        prev = alpha * v + (1 - alpha) * prev
        out[i] = prev
    return out


def bollinger(bars: Bars, n: int, k: float) -> dict[str, Series]:
    closes = [b["c"] for b in bars]
    mid = sma(closes, n)
    upper: Series = [None] * len(bars)
    lower: Series = [None] * len(bars)
    for i, m in enumerate(mid):
        if m is None:
            continue
        window = closes[i - n + 1 : i + 1]
        sd = (sum((x - m) ** 2 for x in window) / n) ** 0.5
        upper[i], lower[i] = m + k * sd, m - k * sd
    return {"upper": upper, "middle": mid, "lower": lower}


def vwap(bars: Bars) -> Series:
    """Session VWAP: cumulative typical-price × volume over volume, reset when the date changes."""
    out: Series = [None] * len(bars)
    pv = vol = 0.0
    day = None
    for i, b in enumerate(bars):
        if b["date"] != day:
            day, pv, vol = b["date"], 0.0, 0.0
        pv += (b["h"] + b["l"] + b["c"]) / 3 * b["v"]
        vol += b["v"]
        out[i] = pv / vol if vol else None
    return out


def rsi(bars: Bars, n: int) -> Series:
    """Wilder's RSI: average gain/loss seeded with the n-bar mean, then RMA-smoothed."""
    closes = [b["c"] for b in bars]
    out: Series = [None] * len(bars)
    if len(closes) <= n:
        return out
    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, len(closes))]
    avg_g = sum(gains[:n]) / n
    avg_l = sum(losses[:n]) / n
    for i in range(n, len(closes)):
        if i > n:
            avg_g = (avg_g * (n - 1) + gains[i - 1]) / n
            avg_l = (avg_l * (n - 1) + losses[i - 1]) / n
        out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def macd(bars: Bars, fast: int, slow: int, signal: int) -> dict[str, Series]:
    closes = [b["c"] for b in bars]
    ef, es = ema(closes, fast), ema(closes, slow)
    line: Series = [None if a is None or b is None else a - b for a, b in zip(ef, es, strict=True)]
    sig = ema(line, signal)
    hist: Series = [
        None if a is None or b is None else a - b for a, b in zip(line, sig, strict=True)
    ]
    return {"macd": line, "signal": sig, "histogram": hist}


def kdj(bars: Bars, n: int, m1: int, m2: int) -> dict[str, Series]:
    out_k: Series = [None] * len(bars)
    out_d: Series = [None] * len(bars)
    out_j: Series = [None] * len(bars)
    k = d = 50.0
    for i in range(len(bars)):
        if i < n - 1:
            continue
        window = bars[i - n + 1 : i + 1]
        hh = max(b["h"] for b in window)
        ll = min(b["l"] for b in window)
        rsv = 50.0 if hh == ll else (bars[i]["c"] - ll) / (hh - ll) * 100
        k = ((m1 - 1) * k + rsv) / m1
        d = ((m2 - 1) * d + k) / m2
        out_k[i], out_d[i], out_j[i] = k, d, 3 * k - 2 * d
    return {"k": out_k, "d": out_d, "j": out_j}


def compute(bars: Bars, ind: dict) -> dict[str, Series]:
    """Named output series for one indicator config (as stored on a chart pane)."""
    t = ind["type"]
    if t == "sma":
        return {"sma": sma([b["c"] for b in bars], ind["period"])}
    if t == "ema":
        return {"ema": ema([b["c"] for b in bars], ind["period"])}
    if t == "bb":
        return bollinger(bars, ind["period"], ind["stddev"])
    if t == "vwap":
        return {"vwap": vwap(bars)}
    if t == "rsi":
        return {"rsi": rsi(bars, ind["period"])}
    if t == "macd":
        return macd(bars, ind["fast"], ind["slow"], ind["signal"])
    if t == "kdj":
        return kdj(bars, ind["period"], ind["k"], ind["d"])
    if t == "volume":
        return {"volume": [float(b["v"]) for b in bars]}
    raise ValueError(f"Unknown indicator {t!r}")


def rounded(series: dict[str, Series], nd: int = 4) -> dict[str, Series]:
    return {k: [_round(x, nd) for x in v] for k, v in series.items()}
