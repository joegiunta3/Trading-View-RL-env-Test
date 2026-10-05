# chartview: RL Environment Spec (v0.1)

A self-contained, resettable web app that behaves like a dark-mode charting and paper-trading terminal, with a simulated trading day that plays out in scaled real time, plus verifiable tasks for training and evaluating browser/computer-use agents.

Repo: https://github.com/joegiunta3/Trading-View-RL-env-Test.git

The product name lives in ONE constant (`APP_NAME` in `config.py` and `frontend/src/config.ts`) so it can be changed in one place.

## 1. Goals and non-goals

**Goals**
- A realistic charting + paper-trading UI that an agent operates through a real browser (screenshots + DOM).
- Time pressure: the market moves while the agent works. Some tasks have sim-time deadlines.
- Deterministic world: `reset(seed)` always produces the identical price paths, scenarios and ground truth. Only the agent's own timing varies.
- Every task has a programmatic verifier checking final app state, the timestamped action log, and/or the agent's final answer. No LLM-only grading.
- Target model pass rate 10-60% on the harder tiers.

**Non-goals**
- No real accounts, real money, real market data, or real network calls. All prices, volumes and scenarios are synthetic. Ticker symbols and company names are real (names only; see §5).
- No ads, promos, upsell banners or login walls. The app is a clean workspace.
- No copying of third-party code, logos, icons, fonts, copy text or images.
- Not in v0.1: news feed, Pine-style scripting, options, margin, mobile layout. (Multi-chart layouts and line drawing tools were added in v0.2; see §6.)

## 2. Visual identity and legal guardrails

- Dark theme with the familiar conventions of professional charting tools: near-black blue-gray workspace, slightly lighter panels, muted low-contrast grid lines, green up candles, red down candles, a single blue accent, light-gray text, right-hand sidebar, top toolbar, bottom trading panel.
- The look should feel the same to an agent and a human, but the identity must be ORIGINAL: own wordmark, own icon set (Lucide), system or open-license font, own microcopy, and own hex values. Do not copy exact colors, layout pixel-for-pixel, or any logo or icon from a real product. "chartview" is already close to a real brand name, so the founder should confirm the name with a lawyer before any public or commercial use. This is not legal advice.
- Define all colors as design tokens in one file (`frontend/src/theme.ts`) so the palette can be changed in one place. Starting palette (adjust freely): background `#11151d`, panel `#181d27`, border `#262c38`, grid `#1f2430`, text `#d3d7df`, muted text `#7d8596`, up `#2bb673`, down `#e5484d`, accent `#3d7eff`.
- Charting library: pick in the Stage 2 plan. Candidate: Lightweight Charts (Apache 2.0). Check its license/NOTICE and any attribution requirement before adopting; if it forces third-party branding into the app, use another open-license library (ECharts, uPlot) instead.

## 3. Tech stack

- Backend: Python 3.12, FastAPI, SQLite (single file) plus in-memory sim state. Reset = rebuild from seed.
- Frontend: React + Vite + TypeScript + Tailwind, built to static files served by FastAPI. Live updates over WebSocket.
- One Dockerfile. App on port 8080; harness endpoints on a separate port (9090). `docker run` gives a working env.
- Tests: pytest (backend, engine, verifiers), Playwright (UI smoke tests and scripted oracle solutions).
- Pin versions. `uv` or `pip`.

## 4. Simulated time

- **Episode = two trading days (v0.2):** day 1 is Thu 2026-01-15 and day 2 is Fri 2026-01-16, each 09:00:00 to 16:30:00 (27,000 sim seconds). Between them is a 45-real-second **after-hours break** (270 sim seconds): trading is closed, Day orders have expired, positions and cash carry over, and the UI shows a countdown; charts, watchlists and alert setup still work. Day 2 opens with an overnight gap; day 1 becomes history on every chart and "change %" is measured from day 1's close. All `sim_ts` values are **episode seconds** from day 1 09:00 (day 2 09:00 = 27,270; episode end = 54,270); see `app/timeline.py`. Planted scenarios can land on either day.
- **Scale:** `TIME_SCALE = 6` sim seconds per real second (config constant), so a full session is 4,500 real seconds (75 minutes) and a full two-day episode about 2.5 real hours. A 1-minute bar forms every 10 real seconds. `reset` accepts `start_day` (1 or 2) with `start_time`, so a task can begin late on day 1 or on day 2.
- **Server-authoritative clock.** The server owns `sim_now`, computed from a monotonic wall-clock since the episode `start`. The frontend never reads the real time and cannot set it.
- **Clock start:** the clock starts when the harness calls `POST /_env/start` (not at page load), so page-load time does not eat into the episode.
- **Task start time:** `reset` accepts `start_time` (default 09:00). A task may start at, say, 12:00 with the morning's history already filled in, which makes lookup tasks about closed windows possible.
- **Speed is part of the skill.** Slow and fast agents see the same world but act at different sim times. This is intentional. Log every action with its `sim_ts` so results can be analysed by speed.
- **Test clock:** a deterministic `fixed-step` mode (clock advances only via `POST /_env/clock/advance`) is REQUIRED so oracle solvers, verifiers and tests are not flaky. Never use it in agent runs.
- **Session end:** at day 1's 16:30 close, working Day orders are cancelled and the after-hours break starts. At day 2's 16:30 close the episode ends: working orders are cancelled, the UI shows "Session closed", the clock stops, and the verifier runs on final state.
- **Wall-clock cap:** harness kills an episode at session length + 5 minutes regardless.

## 5. Market simulation

- **Universe:** 20 real US tickers across 5 sectors (4 each), names only. Prices, history and scenarios are fully synthetic and seeded, and starting price levels are not meant to match real quotes, so knowledge of the real market gives no advantage. No logos or brand assets.
- **Price path:** for each symbol, pre-generate the whole session from the seed at 1-sim-second resolution (regime-switching random walk with intraday volume profile), plus 60 prior sessions at 1-minute resolution (weekdays, excluding US market holidays). Prior daily bars are derived from those minutes, and intraday charts show prior sessions before today (1m: 5 sessions, 5m: 20, 15m and 1h: 60). The clock only reveals today's path progressively; nothing future is sent to the browser.
- **Streaming:** the server pushes the latest price and bar updates once per real second (every 6 sim seconds). Bars (1m, 5m, 15m, 1h, 1D) are built from the path.
- **Spread:** each symbol has a seeded fixed spread (e.g. 1-5 cents). Quotes show bid/ask around the path price.
- **Planted scenarios** (generated from the seed, recorded in `world_truth.json`, never exposed through the UI or API):
  - a gap: one ticker opens +/- 3% vs prior close at 09:00
  - a breakout: ticker A crosses its prior-day high at time T1 and runs +4% over ~20 sim minutes
  - a sharp drop: ticker B falls 5%+ within 10 sim minutes starting at T2
  - a fake-out: ticker E touches a round level at T3 then reverses (stop-loss and false-signal tests)
  - a volume surge on ticker D with flat price at T4
  - a mean-reverting spike on ticker F (limit-order opportunity)
- Different seeds give different tickers, levels and times. Verifiers read `world_truth.json`; the agent can only learn facts by using the app.

## 6. Screens and behavior

Layout: top toolbar (symbol search, timeframe buttons, indicator menu, clock), left slim toolbar, center chart, right sidebar (watchlist / alerts / screener tabs), bottom panel (Positions, Orders, History, P&L).

1. **Chart.** Candlesticks, volume histogram, timeframes 1m, 5m, 15m, 1h, 1D. Indicators: SMA (user-set period, multiple allowed) and Volume only. A DOM legend shows O/H/L/C, change, volume and SMA values for the hovered (or latest) bar, so lookup tasks can be done by reading text, not just pixels. Crosshair, zoom and pan. Chart settings (symbol, timeframe, indicators) are saved server-side per pane.
   - **Line drawing tools (v0.2):** a "Lines" flyout in the left toolbar with Info line, Trendline, Horizontal line and Vertical line (shortcuts Alt+I/T/H/V). Points are anchored to (bar time, price), so drawings survive zoom, pan and timeframe changes, and can be placed in the empty space right of the last bar. The Info line shows price change ($, %, cents), bar count and time span, pixel distance and angle. Drawings belong to the symbol (shown on every pane showing it). Select to drag handles or move; Delete removes; a magnet toggle snaps points to the bar's O/H/L/C; "Remove all drawings" clears the active symbol. A "Drawings" sidebar tab lists every drawing as text.
   - **Layouts (v0.2):** a "Layout setup" toolbar button offers 1 chart, 2 side by side, 3 columns, or a 2×2 grid. Each pane has its own symbol, timeframe and indicators. Clicking a pane makes it active; the toolbar, watchlist, screener, positions and order ticket act on the active pane. Shrinking a layout hides panes but keeps their settings; any pane can be maximized and restored. No cross-pane sync.
2. **Clock display.** Visible sim time (HH:MM:SS) and market status in the toolbar.
3. **Watchlists.** Create, rename, delete watchlists; add/remove tickers; rows show last, change, % change. One default list.
4. **Screener.** Table of all 20 symbols with filters (price range, % change since prior close, volume, sector) and sortable columns. Values are live.
5. **Alerts.** Create price alerts (above, below, crossing up, crossing down) on a symbol, with optional note. Triggered alerts show a toast and appear in an alert log with the sim time they fired. Edit, disable and delete.
6. **Trading panel.** Order ticket: symbol, side (buy / sell / short / cover), quantity, type (market, limit, stop), price fields, time-in-force fixed to Day. Confirmation step before submit. Orders table with cancel.
7. **Positions / History / P&L.** Open positions with avg price, last, unrealized P&L; closed trades; account summary.

Login: auto-signed in as a single seeded account. Seeded starting positions may exist per task.

## 7. Order engine and account rules

- Starting cash $100,000 (tasks may seed starting positions). Long and short allowed. **No margin.**
- Buying power = cash minus reserved cash for working buy orders minus collateral for shorts. A short requires 100% of its notional held as collateral; orders that exceed buying power are rejected with a clear message.
- **Market:** fills immediately at ask (buy/cover) or bid (sell/short) at the current `sim_now`.
- **Limit:** buy fills when ask <= limit; sell fills when bid >= limit; at the limit price or better as per the path.
- **Stop (stop-market):** triggers when the path price touches the stop, then fills like a market order at the next quote.
- Full fills only (no partials), zero commission, Day orders cancelled at close.
- Rejections: zero or negative quantity, insufficient buying power, selling more than held, duplicate identical order within 5 sim seconds (rate-limit message).
- Every order, fill, cancel, alert creation and trigger is written to `action_log` with `sim_ts`.

## 8. Data model (SQLite)

- `symbols(id, ticker, name, sector, spread)`
- `path(symbol_id, day, sim_sec, price, volume)` both episode days at 1-second resolution (server-only, never sent whole)
- `intraday_bars(symbol_id, date, minute, o, h, l, c, v)` 60 prior sessions at 1-minute resolution
- `daily_bars(symbol_id, date, o, h, l, c, v)` 60 prior days, derived from `intraday_bars`
- `account(id, cash, start_cash)`; `positions(symbol_id, qty, avg_price)` (qty negative = short)
- `orders(id, symbol_id, side, type, qty, limit_price, stop_price, status, created_sim_ts, filled_sim_ts, fill_price)`
- `trades(id, order_id, symbol_id, qty, price, sim_ts)`
- `watchlists(id, name)`; `watchlist_items(watchlist_id, symbol_id, position)`
- `alerts(id, symbol_id, condition, price, note, enabled, triggered_sim_ts)`
- `drawings(id, symbol_id, kind, points_json, created_sim_ts, updated_sim_ts)` (v0.2): points are `{time: bar epoch seconds, price: cents}`
- `chart_panes(pane_index 0-3, symbol_id, timeframe, indicators_json)` and `ui_state(key, value)` with `layout` ("1"-"4") and `active_pane` (v0.2; replaces per-symbol `chart_prefs`)
- `action_log(id, wall_ts, sim_ts, endpoint, payload)` for grading and trace review (not visible in the UI)

## 9. Environment API (harness only, not linked from the UI)

- `POST /_env/reset` `{seed, start_time?, clock_mode?: "realtime"|"fixed-step"}` returns `{episode_id}`
- `POST /_env/start`: starts the clock
- `POST /_env/clock/advance` `{sim_seconds}`: fixed-step mode only
- `GET /_env/state`: JSON dump of DB state and `sim_now`
- `POST /_env/grade` `{task_id, answer?}`: runs the verifier, returns `{reward: 0..1, checks: [...], passed: bool}`
- `GET /_env/trace`: `action_log` for the episode

These must not be reachable from the agent's browser (separate port 9090 and a harness token header). See section 11.

## 10. Task set (v0.1: 20 tasks)

Each task has: `id`, `tier`, `prompt`, `params` (seed-derived), `start_time`, `verifier`. Reward 1.0 for a full pass with partial credit for multi-check tasks. Deadlines are in sim time and tuned in calibration; start with windows of 5-30 sim minutes (50-300 real seconds) so they are feasible for an agent taking 5-20 real seconds per step.

**Tier 1: basic actions (5 tasks, ~90%)**
1. Buy N shares of `X` at market. Verify position qty and fill within spread of path price at `filled_sim_ts`.
2. Create a watchlist named "N" containing exactly tickers {A, B, C}.
3. Create an alert: `X` crossing up `$P`. Verify alert row (symbol, condition, price).
4. Set the `X` chart to 15m with an SMA(20) visible. Verify `chart_prefs`.
5. Place a limit sell for your existing position in `X` at `$P`. Verify order type, price and qty.

**Tier 2: lookup and answer (5 tasks, ~60%)** (closed windows; task starts after the window ends)
6. What was `X`'s total volume between 09:30 and 10:00? (numeric, tolerance)
7. What was the SMA(20) value on the 5m chart for `X` at the 10:15 bar close? (numeric, tolerance +/-0.02)
8. Using the screener, which ticker in sector `S` had the largest percent range (high-low over open) between 09:00 and 11:00? (ticker)
9. At what price did `X`'s 1m bar close at 10:47? (numeric)
10. How many tickers closed the previous trading day above their daily SMA(20)? (integer)

**Tier 3: timed execution (6 tasks, ~30%)**
11. Buy N `X` within 10 sim minutes after it crosses above `$P` (scheduled breakout). Verify fill time window.
12. Place a stop-loss on your existing position in `X` at `$P` before 11:00. Verify order exists in time, correct side/price; fail if it triggered wrongly on the fake-out.
13. Place a limit buy on `F` at `$P` so it fills during the spike reversal; must be working before T and filled by 12:00.
14. Short N `X` after it crosses above `$P` and before 11:30, then cover before 14:00 with P&L >= 0.
15. Close your position in `X` once unrealized P&L reaches +$500; verify the closing fill is within 5 sim minutes of the threshold crossing.
16. Flatten all positions (no longs, no shorts) before 16:20. Verify account at close.

**Tier 4: multi-step / investigation (4 tasks, ~10-20%)**
17. Rebalance to equal-dollar weight across tickers {A, B, C, D} (within 5%) by 10:00, using only market and limit orders. Verify holdings and cash.
18. Ticker `B` has a sharp drop planted at T2: exit your long in `B` within 5 sim minutes of the drop starting, without selling any other position. Verify timing and no side effects.
19. Using the screener, identify the ticker with high volume but flat price between 13:00 and 14:00 and report ticker plus its total volume. (ticker exact + numeric tolerance, partial credit)
20. Create alerts on every ticker in sector `S` at +2% from the 09:00 price; when the first alert fires, buy N of that ticker within 5 sim minutes. Verify alerts set and the trade.

All answers go into a "Task complete" box in the harness page or the harness `answer` field, never into the app.

## 11. Anti-reward-hacking requirements

- Agent browser can reach only the app port. `/_env/*` is on a second port or needs a header the browser never receives.
- No future prices, planted-scenario times, or answers in HTML, JS bundles, source maps, WebSocket frames, API responses or page titles. Only data up to `sim_now` is ever served. Run a check that greps built assets for `world_truth`.
- Verifiers check final state AND the timestamped action log (e.g. task 18 fails if unrelated positions were sold).
- Free-text answers use normalized exact match or numeric/set comparison, never "contains".
- Each task has a negative test: a plausible wrong or late solution scores below 1.0.
- Hold out 20% of seeds and 4 tasks as a private test set.

## 12. Harness

- `harness/run_episode.py`: reset env, `start` clock, open a Playwright browser, give the agent the prompt and tools (screenshot, click, type, scroll, key, navigate within the app only), run to session close or the wall-clock cap, call `/_env/grade`, write JSON result and full trajectory (screenshots, actions with `sim_ts`, final grade).
- `harness/eval.py`: run a task set across N seeds and M models, output pass rate per task and tier, plus average action latency, to CSV.
- Agent/model pluggable (Anthropic API model name via env var).
- A scripted oracle solver per task, run in `fixed-step` clock mode, proves each task is solvable and each verifier passes on a correct solution and fails on wrong or late ones.
- Packaging: the core stays standalone (Docker). Stage 5 adds an optional `hud_adapter/` exposing the same tasks via the HUD SDK. The core must not import it.
- Cost note: one episode is up to ~80 minutes of agent time with screenshots; budget accordingly for calibration runs.

## 13. Build stages (do one at a time, stop for review after each)

1. **Backend, clock, engine.** Schema, seed generator, path generation, `world_truth.json`, sim clock (realtime + fixed-step), order engine, alerts, reset/start endpoints, core API. pytest: determinism (same seed gives identical DB hash), engine fills and rejections, clock behavior.
2. **Frontend.** All screens in section 6, original dark identity, live WebSocket updates, no console errors. Playwright smoke test per screen.
3. **Verifiers and oracle solvers.** All 20 tasks, oracle solutions (fixed-step), negative tests. 100% oracle pass, 0% on negatives.
4. **Harness.** `run_episode.py`, `eval.py`, trajectory logging. Run one model on 5 seeds and report pass rates by tier.
5. **Hardening and packaging.** Anti-hacking checks, Dockerfile, README, optional `hud_adapter/`.
6. **Calibration.** Tune time scale, deadlines and difficulty until tiers match target pass rates; document in `CALIBRATION.md`.

## 14. Definition of done (v0.1)

- `docker run -p 8080:8080 -p 9090:9090 chartview-env` serves a working app.
- All 20 tasks solvable by oracle solvers; verifiers pass on correct and fail on incorrect or late solutions.
- Same seed gives the same world; grades depend only on the world and the agent's actions and their sim timing.
- Pass-rate table by tier from at least one frontier model on 5+ seeds.
- No third-party assets or text copied; the app name is a single constant.
