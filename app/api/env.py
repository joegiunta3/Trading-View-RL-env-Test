"""Harness-only app (port 9090). Every route requires the X-Env-Token header."""

import secrets
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StrictInt

from app.engine.errors import EngineError
from app.episode import Episode
from app.holder import EnvHolder


class ResetIn(BaseModel):
    seed: StrictInt
    start_time: str = "09:00"
    start_day: StrictInt = 1  # 1 or 2: the episode always has two trading days
    clock_mode: Literal["realtime", "fixed-step"] = "realtime"
    setup: dict | None = None


class AdvanceIn(BaseModel):
    sim_seconds: StrictInt


class IndicatorQuery(BaseModel):
    ticker: str
    timeframe: str
    indicator: dict


class BacktestQuery(BaseModel):
    ticker: str
    timeframe: str
    strategy: dict


class GradeIn(BaseModel):
    task_id: str
    answer: Any = None


def create_env_app(holder: EnvHolder) -> FastAPI:
    def check_token(x_env_token: str | None = Header(default=None)) -> None:
        if x_env_token is None or not secrets.compare_digest(x_env_token, holder.token):
            raise HTTPException(status_code=401, detail="Missing or invalid env token")

    app = FastAPI(
        title="env",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        dependencies=[Depends(check_token)],
    )

    def ep() -> Episode:
        if holder.episode is None:
            raise EngineError("No episode. Call /_env/reset first.", 409)
        return holder.episode

    @app.exception_handler(EngineError)
    async def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.post("/_env/reset")
    def reset(body: ResetIn) -> dict:
        e = holder.reset(body.seed, body.start_time, body.clock_mode, body.setup, body.start_day)
        return {"episode_id": e.episode_id, "sim_now": e.now, "clock_mode": e.clock.mode.value}

    @app.post("/_env/start")
    def start() -> dict:
        return ep().start()

    @app.post("/_env/clock/advance")
    def advance(body: AdvanceIn) -> dict:
        return ep().advance(body.sim_seconds)

    @app.get("/_env/state")
    def state() -> dict:
        return ep().state()

    @app.get("/_env/trace")
    def trace() -> dict:
        e = ep()
        return {"episode_id": e.episode_id, "actions": e.trace()}

    @app.post("/_env/indicators")
    def indicator_values(body: IndicatorQuery) -> dict:
        """Indicator series (same formulas as the UI) for graders and task writers."""
        return ep().indicator_values(body.ticker, body.timeframe, body.indicator)

    @app.post("/_env/backtest")
    def backtest(body: BacktestQuery) -> dict:
        """Strategy backtest (same engine as the UI's Strategy Tester) for graders and writers."""
        return ep().backtest(body.ticker, body.timeframe, body.strategy)

    @app.post("/_env/grade")
    def grade(body: GradeIn) -> JSONResponse:
        ep()
        return JSONResponse(
            {"detail": f"Grading for {body.task_id!r} is not implemented yet (Stage 3)."},
            status_code=501,
        )

    return app
