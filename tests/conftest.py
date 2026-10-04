"""Shared fixtures. Every episode here uses the fixed-step clock: no test depends on real time."""

import pytest

from app.engine.errors import EngineError
from app.episode import Episode

SEED = 1234


def make_episode(
    seed: int = SEED,
    start_time: str = "09:00",
    setup: dict | None = None,
    start: bool = True,
    start_day: int = 1,
) -> Episode:
    e = Episode(
        seed, start_time=start_time, clock_mode="fixed-step", setup=setup, start_day=start_day
    )
    if start:
        e.start()
    return e


@pytest.fixture
def ep() -> Episode:
    return make_episode()


def px(e: Episode, ticker: str, s: int) -> int:
    return e.world.px[e.world.by_ticker[ticker].id - 1][s]


def quote_at(e: Episode, ticker: str, s: int) -> tuple[int, int]:
    return e.market.bid_ask(e.world.by_ticker[ticker].id, s)


def advance_to(e: Episode, s: int) -> None:
    if s > e.now:
        e.advance(s - e.now)


def order(e: Episode, ticker: str, side: str, typ: str, qty: int, **prices) -> dict:
    return e.place_order({"ticker": ticker, "side": side, "type": typ, "qty": qty, **prices})


def raises_engine(fn, *args, status: int | None = None, match: str = "", **kwargs) -> EngineError:
    with pytest.raises(EngineError) as info:
        fn(*args, **kwargs)
    if status is not None:
        assert info.value.status == status, info.value.message
    assert match in info.value.message
    return info.value
