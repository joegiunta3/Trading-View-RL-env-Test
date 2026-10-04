"""Agent-facing app (port 8080). Contains no /_env routes and nothing that can move the clock.

Every response is computed from data up to sim_now only.
"""

import asyncio
from typing import Literal

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.config import APP_NAME, SESSION_DATE
from app.engine.errors import EngineError
from app.episode import Episode
from app.holder import EnvHolder
from app.market import TIMEFRAMES
from app.world.universe import SECTORS


class OrderIn(BaseModel):
    ticker: str
    side: Literal["buy", "sell", "short", "cover"]
    type: Literal["market", "limit", "stop"]
    qty: int
    limit_price: float | None = None
    stop_price: float | None = None


class NameIn(BaseModel):
    name: str


class TickerIn(BaseModel):
    ticker: str


class AlertIn(BaseModel):
    ticker: str
    condition: Literal["above", "below", "crossing_up", "crossing_down"]
    price: float
    note: str = ""


class AlertPatch(BaseModel):
    condition: Literal["above", "below", "crossing_up", "crossing_down"] | None = None
    price: float | None = None
    note: str | None = None
    enabled: bool | None = None


class Indicator(BaseModel):
    type: str
    period: int | None = None


class ChartPrefsIn(BaseModel):
    timeframe: str
    indicators: list[Indicator] = Field(default_factory=list)


class UiStateIn(BaseModel):
    active_symbol: str


SCREENER_SORT = ("ticker", "last", "change_pct", "volume", "range_pct", "sector")


def create_public_app(holder: EnvHolder) -> FastAPI:
    app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)

    def ep() -> Episode:
        if holder.episode is None:
            raise EngineError("Environment is not ready.", 503)
        return holder.episode

    @app.exception_handler(EngineError)
    async def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.get("/api/config")
    def config() -> dict:
        return {
            "app_name": APP_NAME,
            "session_date": SESSION_DATE,
            "timeframes": list(TIMEFRAMES),
            "sectors": list(SECTORS),
        }

    @app.get("/api/clock")
    def clock() -> dict:
        return ep().clock_view()

    @app.get("/api/symbols")
    def symbols() -> list[dict]:
        return ep().symbols()

    @app.get("/api/quotes")
    def quotes() -> list[dict]:
        return ep().quotes()

    @app.get("/api/quotes/{ticker}")
    def quote(ticker: str) -> dict:
        return ep().quote(ticker)

    @app.get("/api/bars/{ticker}")
    def bars(ticker: str, tf: str = "5m") -> dict:
        e = ep()
        return {"ticker": ticker.upper(), "timeframe": tf, "bars": e.bars(ticker, tf)}

    @app.get("/api/screener")
    def screener(
        sector: str | None = None,
        min_price: float | None = None,
        max_price: float | None = None,
        min_change_pct: float | None = None,
        max_change_pct: float | None = None,
        min_volume: int | None = None,
        sort: str = "ticker",
        order: Literal["asc", "desc"] = "asc",
    ) -> list[dict]:
        if sort not in SCREENER_SORT:
            raise EngineError(
                f"Cannot sort by {sort!r}. Use one of {', '.join(SCREENER_SORT)}.", 422
            )
        rows = ep().quotes()
        checks = [
            (sector, lambda r: r["sector"].lower() == sector.lower()),
            (min_price, lambda r: r["last"] >= min_price),
            (max_price, lambda r: r["last"] <= max_price),
            (min_change_pct, lambda r: r["change_pct"] >= min_change_pct),
            (max_change_pct, lambda r: r["change_pct"] <= max_change_pct),
            (min_volume, lambda r: r["volume"] >= min_volume),
        ]
        for value, pred in checks:
            if value is not None:
                rows = [r for r in rows if pred(r)]
        return sorted(rows, key=lambda r: (r[sort], r["ticker"]), reverse=order == "desc")

    @app.get("/api/account")
    def account() -> dict:
        return ep().account_summary()

    @app.get("/api/positions")
    def positions() -> list[dict]:
        return ep().positions()

    @app.get("/api/orders")
    def list_orders() -> list[dict]:
        return ep().list_orders()

    @app.post("/api/orders")
    def place_order(body: OrderIn) -> dict:
        return ep().place_order(body.model_dump())

    @app.delete("/api/orders/{order_id}")
    def cancel_order(order_id: int) -> dict:
        return ep().cancel_order(order_id)

    @app.get("/api/trades")
    def trades() -> list[dict]:
        return ep().trades()

    @app.get("/api/watchlists")
    def watchlists() -> list[dict]:
        return ep().watchlists()

    @app.post("/api/watchlists")
    def create_watchlist(body: NameIn) -> dict:
        return ep().create_watchlist(body.name)

    @app.patch("/api/watchlists/{wid}")
    def rename_watchlist(wid: int, body: NameIn) -> dict:
        return ep().rename_watchlist(wid, body.name)

    @app.delete("/api/watchlists/{wid}")
    def delete_watchlist(wid: int) -> dict:
        ep().delete_watchlist(wid)
        return {"ok": True}

    @app.post("/api/watchlists/{wid}/items")
    def add_item(wid: int, body: TickerIn) -> dict:
        return ep().add_watchlist_item(wid, body.ticker)

    @app.delete("/api/watchlists/{wid}/items/{ticker}")
    def remove_item(wid: int, ticker: str) -> dict:
        return ep().remove_watchlist_item(wid, ticker)

    @app.get("/api/alerts")
    def list_alerts() -> list[dict]:
        return ep().list_alerts()

    @app.get("/api/alerts/log")
    def alert_log() -> list[dict]:
        return ep().alert_log()

    @app.post("/api/alerts")
    def create_alert(body: AlertIn) -> dict:
        return ep().create_alert(body.ticker, body.condition, body.price, body.note)

    @app.patch("/api/alerts/{alert_id}")
    def update_alert(alert_id: int, body: AlertPatch) -> dict:
        return ep().update_alert(alert_id, body.model_dump())

    @app.delete("/api/alerts/{alert_id}")
    def delete_alert(alert_id: int) -> dict:
        ep().delete_alert(alert_id)
        return {"ok": True}

    @app.get("/api/chart_prefs/{ticker}")
    def get_prefs(ticker: str) -> dict:
        return ep().get_chart_prefs(ticker)

    @app.put("/api/chart_prefs/{ticker}")
    def put_prefs(ticker: str, body: ChartPrefsIn) -> dict:
        inds = [i.model_dump(exclude_none=True) for i in body.indicators]
        return ep().set_chart_prefs(ticker, body.timeframe, inds)

    @app.get("/api/ui_state")
    def get_ui_state() -> dict:
        return ep().get_ui_state()

    @app.put("/api/ui_state")
    def put_ui_state(body: UiStateIn) -> dict:
        return ep().set_active_symbol(body.active_symbol)

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        await stream(socket, holder)

    return app


def tick_frame(e: Episode, sub: dict | None) -> dict:
    """One push frame: clock, all quotes, and the latest bars of the subscribed chart."""
    frame: dict = {"type": "tick", "clock": e.clock_view(), "quotes": e.quotes()}
    if sub:
        try:
            frame["bars"] = {
                "ticker": sub["ticker"].upper(),
                "timeframe": sub["tf"],
                "bars": e.bars(sub["ticker"], sub["tf"])[-2:],
            }
        except (EngineError, KeyError, AttributeError):
            frame["bars"] = None
    return frame


async def stream(socket: WebSocket, holder: EnvHolder, interval: float = 1.0) -> None:
    """Push a tick frame once per real second plus any engine events (fills, alerts...)."""
    await socket.accept()
    state: dict = {"sub": None}

    async def receive() -> None:
        while True:
            msg = await socket.receive_json()
            if isinstance(msg, dict) and isinstance(msg.get("subscribe"), dict):
                state["sub"] = msg["subscribe"]

    receiver = asyncio.create_task(receive())
    episode, seq = None, 0
    try:
        while not receiver.done():
            e = holder.episode
            if e is None:
                await asyncio.sleep(interval)
                continue
            if e is not episode:
                if episode is not None:
                    await socket.send_json({"type": "reset"})
                episode, seq = e, 0
            frame = await run_in_threadpool(tick_frame, e, state["sub"])
            events = e.events_since(seq)
            seq += len(events)
            for ev in events:
                await socket.send_json({"type": "event", "event": ev})
            await socket.send_json(frame)
            await asyncio.sleep(interval)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        receiver.cancel()
