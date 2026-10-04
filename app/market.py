"""Read-only market views of the world, always truncated at the current sim second.

Nothing here can return data for a second later than `t`.
"""

from array import array
from functools import lru_cache

from app.config import SEED_CACHE, SESSION_DATE, SESSION_SECONDS
from app.timeutil import cents_to_usd, date_epoch, fmt_hhmmss, sim_epoch
from app.world.generate import World, build_world

TIMEFRAMES: dict[str, int | None] = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1D": None}
# Prior sessions shown before today on each intraday timeframe (all bars are in the past).
HISTORY_SESSIONS = {"1m": 5, "5m": 20, "15m": 60, "1h": 60}
OPEN_OFFSET = 9 * 3600  # 09:00 in seconds after midnight

Agg = tuple[int, int, int, int, int]  # o, h, l, c, v


def last_idx(t: int) -> int:
    """Index of the latest revealed path second at sim time t."""
    return min(t, SESSION_SECONDS - 1)


def _combine(parts: list[Agg]) -> Agg:
    return (
        parts[0][0],
        max(p[1] for p in parts),
        min(p[2] for p in parts),
        parts[-1][3],
        sum(p[4] for p in parts),
    )


class SymbolSeries:
    def __init__(self, px: array, vol: array):
        self.px = px
        self.vol = vol
        n = len(px)
        self.cumvol = array("q", bytes(8 * (n + 1)))
        self.run_hi = array("q", bytes(8 * n))
        self.run_lo = array("q", bytes(8 * n))
        hi, lo, cv = px[0], px[0], 0
        for s in range(n):
            p = px[s]
            hi = p if p > hi else hi
            lo = p if p < lo else lo
            cv += vol[s]
            self.run_hi[s], self.run_lo[s], self.cumvol[s + 1] = hi, lo, cv
        self.minutes: list[Agg] = [self._raw(m * 60, m * 60 + 59) for m in range(n // 60)]

    def _raw(self, a: int, b: int) -> Agg:
        seg = self.px[a : b + 1]
        return (seg[0], max(seg), min(seg), seg[-1], self.cumvol[b + 1] - self.cumvol[a])

    def agg(self, a: int, b: int) -> Agg:
        """OHLCV over seconds [a, b] inclusive; `a` must be minute aligned."""
        full_end = (b + 1) // 60  # minutes [a//60, full_end) are complete
        parts = self.minutes[a // 60 : full_end]
        if full_end * 60 <= b:
            parts = parts + [self._raw(max(a, full_end * 60), b)]
        return _combine(parts)


class MarketData:
    def __init__(self, world: World):
        self.world = world
        self.series = [SymbolSeries(world.px[i], world.vol[i]) for i in range(len(world.symbols))]

    def history_bars(self, sid: int, tf: str) -> list[dict]:
        """Completed bars of prior sessions for an intraday timeframe (computed per call)."""
        per = TIMEFRAMES[tf] // 60  # minutes per bar
        out = []
        for sess in self.world.history[sid - 1][-HISTORY_SESSIONS[tf] :]:
            base = date_epoch(sess.date) + OPEN_OFFSET
            minutes = sess.minutes
            for m in range(0, len(minutes), per):
                agg = _combine(minutes[m : m + per])
                out.append(_bar(base + m * 60, sess.date, fmt_hhmmss(m * 60)[:5], agg))
        return out

    def price(self, sid: int, t: int) -> int:
        return self.series[sid - 1].px[last_idx(t)]

    def bid_ask(self, sid: int, s: int) -> tuple[int, int]:
        p = self.series[sid - 1].px[last_idx(s)]
        spread = self.world.symbols[sid - 1].spread
        bid = p - spread // 2
        return bid, bid + spread

    def prev_close(self, sid: int) -> int:
        return self.world.daily[sid - 1][-1].c

    def quote(self, sid: int, t: int) -> dict:
        ser = self.series[sid - 1]
        i = last_idx(t)
        last, prev = ser.px[i], self.prev_close(sid)
        bid, ask = self.bid_ask(sid, t)
        sym = self.world.symbols[sid - 1]
        return {
            "ticker": sym.ticker,
            "name": sym.name,
            "sector": sym.sector,
            "last": cents_to_usd(last),
            "bid": cents_to_usd(bid),
            "ask": cents_to_usd(ask),
            "prev_close": cents_to_usd(prev),
            "change": cents_to_usd(last - prev),
            "change_pct": round((last - prev) / prev * 100, 2),
            "open": cents_to_usd(ser.px[0]),
            "high": cents_to_usd(ser.run_hi[i]),
            "low": cents_to_usd(ser.run_lo[i]),
            "volume": ser.cumvol[i + 1],
            "range_pct": round((ser.run_hi[i] - ser.run_lo[i]) / ser.px[0] * 100, 2),
        }

    def bars(self, sid: int, tf: str, t: int, last: int | None = None) -> list[dict]:
        """All bars up to t, or only the newest `last` bars (cheap; used for live pushes)."""
        if tf not in TIMEFRAMES:
            raise ValueError(f"Unknown timeframe {tf!r}")
        ser = self.series[sid - 1]
        i = last_idx(t)
        width = TIMEFRAMES[tf]
        if width is None:
            if last is not None:
                prior = self.world.daily[sid - 1][-(last - 1) :] if last > 1 else []
                return [
                    _bar(date_epoch(b.date), b.date, b.date, (b.o, b.h, b.l, b.c, b.v))
                    for b in prior
                ] + [_bar(date_epoch(SESSION_DATE), SESSION_DATE, SESSION_DATE, ser.agg(0, i))]
            out = [
                _bar(date_epoch(b.date), b.date, b.date, (b.o, b.h, b.l, b.c, b.v))
                for b in self.world.daily[sid - 1]
            ]
            out.append(_bar(date_epoch(SESSION_DATE), SESSION_DATE, SESSION_DATE, ser.agg(0, i)))
            return out
        starts = range(0, i + 1, width)
        if last is not None:
            starts = starts[-last:]
        today = [
            _bar(sim_epoch(a), SESSION_DATE, fmt_hhmmss(a)[:5], ser.agg(a, min(a + width - 1, i)))
            for a in starts
        ]
        if last is not None and len(today) >= last:
            return today  # live pushes only need the newest bars
        history = self.history_bars(sid, tf)
        return (history + today)[-last:] if last is not None else history + today


def _bar(time: int, date: str, label: str, agg: Agg) -> dict:
    """One bar. `label` is its open time (HH:MM), or its date for daily bars."""
    o, h, lo, c, v = agg
    return {
        "time": time,
        "date": date,
        "label": label,
        "o": cents_to_usd(o),
        "h": cents_to_usd(h),
        "l": cents_to_usd(lo),
        "c": cents_to_usd(c),
        "v": v,
    }


@lru_cache(maxsize=SEED_CACHE)
def market_for_seed(seed: int) -> MarketData:
    return MarketData(build_world(seed))
