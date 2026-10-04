"""Run the public app (8080) and the env app (9090) in one process sharing one Episode.

    python -m app.main [--dev-seed 1234]
    python -m app.main --public-demo 1234 --host 0.0.0.0

--dev-seed resets and starts a realtime episode on boot (manual testing only; the
harness always calls /_env/reset itself).

--public-demo runs a shareable, always-live demo: it starts a realtime day on boot and,
after each 16:30 close, waits DEMO_PAUSE_S real seconds and starts the next day with the
next seed. The env API is NOT started in this mode, so nothing harness-only is reachable.
"""

import argparse
import asyncio
import os
import sys

import uvicorn

from app.api.env import create_env_app
from app.api.public import create_public_app
from app.clock import ClockState
from app.config import APP_NAME, DATA_DIR, ENV_PORT, ENV_TOKEN_VAR, PUBLIC_PORT
from app.holder import EnvHolder

DEMO_PAUSE_S = 120


async def ticker(holder: EnvHolder) -> None:
    """Advance event processing once per real second (fills, alerts, the close)."""
    while True:
        e = holder.episode
        if e is not None:
            await asyncio.to_thread(e.sync)
        await asyncio.sleep(1.0)


async def demo_days(holder: EnvHolder, first_seed: int) -> None:
    """Public demo: start the next simulated day a short while after each close."""
    seed = first_seed
    await asyncio.to_thread(lambda: holder.reset(seed, "09:00", "realtime", None).start())
    while True:
        await asyncio.sleep(5.0)
        e = holder.episode
        if e is not None and e.clock.state is ClockState.CLOSED:
            await asyncio.sleep(DEMO_PAUSE_S)
            seed += 1
            await asyncio.to_thread(
                lambda s=seed: holder.reset(s, "09:00", "realtime", None).start()
            )
            print(f"{APP_NAME}: demo started a new day (seed {seed})", file=sys.stderr)


async def serve(holder: EnvHolder, host: str, demo_seed: int | None) -> None:
    servers = [
        uvicorn.Server(uvicorn.Config(create_public_app(holder), host=host, port=PUBLIC_PORT))
    ]
    if demo_seed is None:
        servers.append(
            uvicorn.Server(uvicorn.Config(create_env_app(holder), host=host, port=ENV_PORT))
        )
    tasks = [asyncio.create_task(ticker(holder))]
    if demo_seed is not None:
        tasks.append(asyncio.create_task(demo_days(holder, demo_seed)))
    try:
        await asyncio.gather(*(s.serve() for s in servers))
    finally:
        for t in tasks:
            t.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} environment server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--dev-seed", type=int, default=None)
    parser.add_argument("--public-demo", type=int, default=None, metavar="SEED")
    args = parser.parse_args()
    holder = EnvHolder(DATA_DIR)
    if args.public_demo is not None:
        print(f"{APP_NAME}: public demo on :{PUBLIC_PORT} (env API disabled)", file=sys.stderr)
    else:
        print(f"{APP_NAME}: app on :{PUBLIC_PORT}, env API on :{ENV_PORT}", file=sys.stderr)
        if not os.environ.get(ENV_TOKEN_VAR):
            print(f"{ENV_TOKEN_VAR} not set; generated token: {holder.token}", file=sys.stderr)
        if args.dev_seed is not None:
            holder.reset(args.dev_seed, "09:00", "realtime", None).start()
    asyncio.run(serve(holder, args.host, args.public_demo))


if __name__ == "__main__":
    main()
