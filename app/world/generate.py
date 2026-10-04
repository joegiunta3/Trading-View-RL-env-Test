"""build_world(seed): the full deterministic world (pure, no I/O)."""

import json
from array import array
from dataclasses import dataclass
from functools import cached_property, lru_cache

from app.config import SEED_CACHE, SESSION_DATE
from app.rng import derive_rng
from app.timeutil import fmt_hhmmss, parse_hhmm
from app.world import scenarios as sc
from app.world.daily import DailyBar, Session, gen_history
from app.world.paths import gen_intraday
from app.world.universe import Symbol, base_universe

MAX_ATTEMPTS = 100
MAX_BREAKOUT_SUBATTEMPTS = 200
ROLES = ("gap", "breakout", "sharp_drop", "fakeout", "volume_surge", "spike")


@dataclass(frozen=True)
class World:
    seed: int
    attempt: int
    symbols: tuple[Symbol, ...]
    px: tuple[array, ...]  # [symbol index][sim_sec] price in cents (array "q")
    vol: tuple[array, ...]  # [symbol index][sim_sec] shares (array "q")
    daily: tuple[tuple[DailyBar, ...], ...]  # derived from `history`
    history: tuple[tuple[Session, ...], ...]  # [symbol index][session] 1-minute bars
    default_watchlist: tuple[str, ...]
    truth_json: str  # canonical JSON; never served to the agent

    @cached_property
    def truth(self) -> dict:
        return json.loads(self.truth_json)

    @cached_property
    def by_ticker(self) -> dict[str, Symbol]:
        return {s.ticker: s for s in self.symbols}


def _window(rng, role: str) -> int:
    a, b = sc.WINDOWS[role]
    return rng.randint(parse_hhmm(a), parse_hhmm(b))


def _attempt(seed: int, attempt: int) -> World:
    universe = base_universe()
    tickers = [t for t, _, _ in universe]
    srng = derive_rng(seed, attempt, "scenarios")
    roles = dict(zip(ROLES, srng.sample(tickers, len(ROLES)), strict=True))
    times = {r: _window(srng, r) for r in sc.WINDOWS}
    gap_sign = 1 if srng.random() < 0.5 else -1
    gap_mag = srng.uniform(0.031, 0.039)
    surge_factor = srng.uniform(4.0, 6.0)
    role_of = {t: r for r, t in roles.items()}

    symbols, pxs, vols, dailies, histories = [], [], [], [], []
    truth_sc: dict[str, dict] = {}
    for idx, (ticker, name, sector) in enumerate(universe):
        prng = derive_rng(seed, attempt, "params", ticker)
        start_px = prng.uniform(20.0, 400.0)
        daily_vol = prng.uniform(0.012, 0.025)
        base_volume = prng.randint(1_000_000, 20_000_000)
        spread = prng.randint(1, 5)
        overnight = prng.uniform(-0.008, 0.008)
        symbols.append(Symbol(idx + 1, ticker, name, sector, spread))

        history = gen_history(
            derive_rng(seed, attempt, "history", ticker), start_px, daily_vol, base_volume
        )
        daily = [s.daily() for s in history]
        prior_close = daily[-1].c
        role = role_of.get(ticker)
        if role == "gap":
            overnight = gap_sign * gap_mag
        elif role == "breakout":
            overnight = -abs(overnight)  # open at/below prior close leaves room under the high
        open_px = prior_close / 100.0 * (1.0 + overnight)

        entry: dict = {"ticker": ticker}
        if role == "breakout":
            t1, h = times["breakout"], daily[-1].h
            path, fvol = _breakout_path(
                seed, attempt, ticker, open_px, daily_vol, base_volume, t1, h
            )
            entry |= {"t1_sec": t1, **sc.measure_breakout(path, h, t1)}
        else:
            base, fvol = gen_intraday(
                derive_rng(seed, attempt, "path", ticker), open_px, daily_vol, base_volume
            )
            if role == "fakeout":
                t3 = times["fakeout"]
                path, level = sc.plant_fakeout(base, t3)
                sc.scale_volume(fvol, t3 - 300, t3 + 300, 1.5)
                entry |= {"t3_sec": t3, **sc.measure_fakeout(path, level, t3)}
            else:
                if role == "sharp_drop":
                    base = sc.plant_sharp_drop(base, times["sharp_drop"])
                    sc.scale_volume(
                        fvol, times["sharp_drop"], times["sharp_drop"] + sc.DROP_WINDOW, 3.0
                    )
                elif role == "volume_surge":
                    base = sc.plant_flat_hour(base)
                    t4 = times["volume_surge"]
                    sc.scale_volume(fvol, t4, t4 + sc.SURGE_LEN, surge_factor)
                elif role == "spike":
                    base = sc.plant_spike(base, times["spike"])
                    sc.scale_volume(fvol, times["spike"], times["spike"] + 780, 2.5)
                path = sc.round_path(base)
                if role == "gap":
                    entry |= {
                        "prior_close_cents": prior_close,
                        "open_cents": path[0],
                        "gap_pct": sc.pct(path[0], prior_close),
                    }
                    if not 0.03 <= abs(entry["gap_pct"]) <= 0.04:
                        raise sc.ScenarioError("gap outside 3-4%")
                elif role == "sharp_drop":
                    entry |= {
                        "t2_sec": times["sharp_drop"],
                        **sc.measure_sharp_drop(path, times["sharp_drop"]),
                    }
                elif role == "volume_surge":
                    entry |= {
                        "t4_sec": times["volume_surge"],
                        "t4_end_sec": times["volume_surge"] + sc.SURGE_LEN,
                    }
                elif role == "spike":
                    entry |= {"start_sec": times["spike"], **sc.measure_spike(path, times["spike"])}
        if min(path) <= 0:
            raise sc.ScenarioError("non-positive price")
        if role is not None:
            truth_sc[role] = entry
        pxs.append(array("q", path))
        vols.append(array("q", (int(v + 0.5) for v in fvol)))
        dailies.append(tuple(daily))
        histories.append(tuple(history))

    _validate_uniqueness(roles, tickers, pxs, vols, truth_sc)
    for entry in truth_sc.values():
        for k in [k for k in entry if k.endswith("_sec")]:
            entry[k.removesuffix("_sec") + "_time"] = fmt_hhmmss(entry[k])

    wrng = derive_rng(seed, "watchlist")
    watch = tuple(sorted(wrng.sample(tickers, 6), key=tickers.index))
    truth = {
        "seed": seed,
        "attempt": attempt,
        "session_date": SESSION_DATE,
        "roles": roles,
        "scenarios": truth_sc,
    }
    return World(
        seed=seed,
        attempt=attempt,
        symbols=tuple(symbols),
        px=tuple(pxs),
        vol=tuple(vols),
        daily=tuple(dailies),
        history=tuple(histories),
        default_watchlist=watch,
        truth_json=json.dumps(truth, sort_keys=True, separators=(",", ":")),
    )


def _breakout_path(seed, attempt, ticker, open_px, daily_vol, base_volume, t1, h):
    """Regenerate the breakout ticker's day (seeded sub-attempts) until it fits under H."""
    for k in range(MAX_BREAKOUT_SUBATTEMPTS):
        rng = derive_rng(seed, attempt, "path", ticker, "breakout", k)
        base, fvol = gen_intraday(rng, open_px, daily_vol, base_volume)
        try:
            path = sc.plant_breakout(base, t1, h)
        except sc.ScenarioError:
            continue
        sc.scale_volume(fvol, t1, t1 + sc.BREAKOUT_RUN, 2.5)
        return path, fvol
    raise sc.ScenarioError("no breakout path fits under the prior-day high")


def _validate_uniqueness(roles, tickers, pxs, vols, truth_sc) -> None:
    """Planted facts must be unambiguous: one sharp drop, one flat high-volume hour."""
    limit = sc.OTHER_DRAWDOWN_LIMIT_PCT / 100
    for i, t in enumerate(tickers):
        if t != roles["sharp_drop"] and sc.max_drawdown_pct_window(pxs[i], 600) >= limit:
            raise sc.ScenarioError(f"{t} has an unplanned 10-minute drop")

    stats = {}
    for i, t in enumerate(tickers):
        rng_pct, hour_vol = sc.hour_stats(pxs[i], vols[i], sc.T_1300, sc.T_1400)
        stats[t] = (rng_pct, hour_vol / (sum(vols[i]) / 7.5))
    d = roles["volume_surge"]
    d_range, d_ratio = stats[d]
    for t, (r, ratio) in stats.items():
        if t != d and (r < 2 * d_range or ratio * 1.25 > d_ratio):
            raise sc.ScenarioError(f"volume-surge signature not unique ({t})")
    i = tickers.index(d)
    truth_sc["volume_surge"] |= {
        "volume_1300_1400": sum(vols[i][sc.T_1300 : sc.T_1400]),
        "range_pct_1300_1400": round(d_range, 6),
        "volume_ratio_1300_1400": round(d_ratio, 6),
    }


@lru_cache(maxsize=SEED_CACHE)
def build_world(seed: int) -> World:
    """Deterministic world for `seed`. Retries deterministically if an invariant fails."""
    last_error: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return _attempt(seed, attempt)
        except sc.ScenarioError as e:
            last_error = e
    raise RuntimeError(f"Could not build world for seed {seed}: {last_error}")
