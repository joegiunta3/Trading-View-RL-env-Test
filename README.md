# chartview RL environment

A deterministic, resettable dark-mode charting and paper-trading web app with a simulated trading
day (09:00–16:30, 1 real second = 6 sim seconds), built for training and evaluating browser-use
agents. See `SPEC.md` for the full design and `CLAUDE.md` for working rules.

**All market data is simulated.** Ticker symbols and company names are real for realism only;
prices, volumes, history and events are generated from a seed and are not real quotes.

## Quick start (local)

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 22+.

```bash
uv sync
cd frontend && npm ci && npm run build && cd ..
CHARTVIEW_ENV_TOKEN=devtok uv run python -m app.main --dev-seed 1234
```

Open http://127.0.0.1:8080. `--dev-seed` starts a live day immediately; a 1-minute candle forms
every 10 real seconds.

| Timeframe | Real time per candle |
|---|---|
| 1m | 10 s |
| 5m | 50 s |
| 15m | 2.5 min |
| 1h | 10 min |
| 1D | 75 min (the whole session) |

## Ports

- **8080**: the app (what the agent's browser sees).
- **9090**: harness-only env API (`/_env/reset`, `/_env/start`, `/_env/clock/advance`, `/_env/state`,
  `/_env/trace`, `/_env/grade`); every call needs the `X-Env-Token` header. Never expose it publicly.

Example (fixed-step clock, used by tests and oracle solvers):

```bash
H='X-Env-Token: devtok'
curl -H "$H" -H 'Content-Type: application/json' -X POST localhost:9090/_env/reset \
  -d '{"seed":1234,"clock_mode":"fixed-step"}'
curl -H "$H" -X POST localhost:9090/_env/start
curl -H "$H" -H 'Content-Type: application/json' -X POST localhost:9090/_env/clock/advance \
  -d '{"sim_seconds":3600}'
```

## Tests

```bash
uv run pytest                          # backend, determinism, leak and frontend static checks
cd frontend && npx playwright install chromium && npx playwright test   # UI end-to-end
```

## Public demo (Render)

`--public-demo SEED` runs a shareable, always-live demo: a realtime day starts on boot, and a new
day (next seed) starts 2 minutes after each close. The env API is not started in this mode.

Deploy on Render:

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick this repo. Render reads `render.yaml` and builds the
   `Dockerfile`.
3. Share the `https://<service>.onrender.com` URL.

Notes:
- Everyone who opens the demo shares one simulated day and one paper account.
- On the free plan the service sleeps after ~15 minutes without traffic; the next visit wakes it
  (about 30–60 s) and starts a fresh day.

Run the same container locally:

```bash
docker build -t chartview-env .
docker run --rm -p 8080:8080 chartview-env
```

## Layout

```
app/        FastAPI backend: sim clock, world generator, order engine, alerts, APIs
frontend/   React + Vite + TypeScript + Tailwind UI (ECharts for charts)
tests/      pytest suite
```

Third-party licenses: see `THIRD_PARTY_NOTICES.md`.
