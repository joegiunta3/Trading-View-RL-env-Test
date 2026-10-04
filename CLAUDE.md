# CLAUDE.md: chartview RL Environment

Read `SPEC.md` first. It is the source of truth for scope, data model, tasks and stages.

Repo: https://github.com/joegiunta3/Trading-View-RL-env-Test.git

## What we are building
A deterministic, resettable, fake dark-mode charting and paper-trading web app ("chartview") with a simulated trading day (09:00 to 16:30, 1 real second = 6 sim seconds), plus verifiable tasks and a harness for evaluating browser-use agents. It is a product for AI labs, so correctness, determinism and grader integrity matter more than polish.

## Working rules
- Work ONE stage of SPEC.md section 13 at a time. At the end of each stage: run all tests, summarize what exists and what is missing, and stop for review. Do not start the next stage unprompted.
- Plan before coding. For each stage, write a short plan (files, approach, risks) and wait for approval if it deviates from SPEC.md.
- Keep the app name in the single `APP_NAME` constant. Never hardcode it elsewhere. Keep all colors in `frontend/src/theme.ts` tokens.
- All market data is synthetic: seeded prices, volumes and scenarios, no real market data, no real network calls, no real user data. Ticker symbols and company names are real (owner decision, 2026-10-04, internal testing env), names only: no logos, brand assets or copied text, and price levels are not meant to match real quotes.
- Do not copy code, text, logos, icons, colors or images from any real product. Original branding and open-license assets only. Before adding a charting library, check its license and attribution requirements and report them.
- No ads, promos or upsell UI anywhere.

## Integrity rules (never break these)
- NEVER modify a verifier, a task, or `world_truth` generation just to make a failing task pass. If a task fails, fix the app or report that the task is wrong and explain why.
- NEVER expose `world_truth.json`, `/_env/*`, future prices, or answers to the agent-facing browser (HTML, JS, source maps, API and WebSocket responses, page titles). The server only ever sends data up to `sim_now`.
- Determinism: the same seed must produce byte-identical world data. Keep a test that hashes the DB and price paths for a fixed seed. No `random` without an explicit seeded `random.Random`; no `datetime.now()` or `time.time()` in world generation or grading. The only real-time dependency is the sim clock.
- The sim clock is server-authoritative. The frontend never reads the real time and cannot set the clock.
- Tests and oracle solvers MUST use the `fixed-step` clock mode. Never write a test that depends on real elapsed time.
- Every task needs: an oracle solver, a positive test, and at least one negative test (including a late-solution negative for timed tasks).
- Do not weaken or delete tests to get green.

## Code standards
- Python 3.12, type hints, FastAPI, SQLite. Format with ruff. Tests with pytest.
- Frontend: React + Vite + TypeScript + Tailwind. No console errors or warnings in Playwright runs.
- Small modules, clear names, short docstrings where intent isn't obvious.
- Pin dependencies. One-command setup documented in README.

## Skills and tooling
- Use Anthropic's `frontend-design` skill during Stage 2 so the UI has an intentional, original look rather than a template or a clone.
- Use a Playwright / webapp-testing skill for UI smoke tests and for driving the app while debugging.
- Project skills worth adding under `.claude/skills/` (create with the skill-creator skill when needed):
  - `add-task`: checklist for a new task (spec entry, params, verifier, oracle solver, positive test, negative test, late-solution test).
  - `leak-audit`: greps built assets, API and WebSocket output for `world_truth`, `/_env`, and future-price leakage.
  - `determinism-check`: runs the seed hash test across several seeds and clock modes.
- Optional hook: run `ruff` and a fast pytest subset before each commit.

## Commands (fill in as they are created)
- Setup: `uv sync` (Python 3.12, pinned deps in `pyproject.toml` / `uv.lock`)
- Run app: `CHARTVIEW_ENV_TOKEN=<token> uv run python -m app.main` (app on :8080, env API on :9090; add `--dev-seed 1234` to auto-reset and start a realtime episode)
- Tests: `uv run pytest` (backend), `npx playwright test` (from Stage 2)
- Lint/format: `uv run ruff check . && uv run ruff format --check .`
- Seed: `uv run python -m app.seed --seed 1234` (writes `data/seed-1234/world.db` + `world_truth.json`, prints the world hash)
- Eval: `python -m harness.eval --tasks all --seeds 5` (from Stage 4)

## When unsure
Ask. If SPEC.md is ambiguous or a requirement looks wrong, say so and propose a change rather than silently deciding.
