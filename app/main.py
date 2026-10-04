"""Run the public app (8080) and the env app (9090) in one process sharing one Episode.

    python -m app.main [--dev-seed 1234]

--dev-seed resets and starts a realtime episode on boot (manual testing only; the
harness always calls /_env/reset itself).
"""

import argparse
import asyncio
import os
import sys

import uvicorn

from app.api.env import create_env_app
from app.api.public import create_public_app
from app.config import APP_NAME, DATA_DIR, ENV_PORT, ENV_TOKEN_VAR, PUBLIC_PORT
from app.holder import EnvHolder


async def ticker(holder: EnvHolder) -> None:
    """Advance event processing once per real second (fills, alerts, the close)."""
    while True:
        e = holder.episode
        if e is not None:
            await asyncio.to_thread(e.sync)
        await asyncio.sleep(1.0)


async def serve(holder: EnvHolder, host: str) -> None:
    servers = [
        uvicorn.Server(uvicorn.Config(create_public_app(holder), host=host, port=PUBLIC_PORT)),
        uvicorn.Server(uvicorn.Config(create_env_app(holder), host=host, port=ENV_PORT)),
    ]
    tick = asyncio.create_task(ticker(holder))
    try:
        await asyncio.gather(*(s.serve() for s in servers))
    finally:
        tick.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} environment server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--dev-seed", type=int, default=None)
    args = parser.parse_args()
    holder = EnvHolder(DATA_DIR)
    print(f"{APP_NAME}: app on :{PUBLIC_PORT}, env API on :{ENV_PORT}", file=sys.stderr)
    if not os.environ.get(ENV_TOKEN_VAR):
        print(f"{ENV_TOKEN_VAR} not set; generated token: {holder.token}", file=sys.stderr)
    if args.dev_seed is not None:
        holder.reset(args.dev_seed, "09:00", "realtime", None).start()
    asyncio.run(serve(holder, args.host))


if __name__ == "__main__":
    main()
