# chartview: SPEC v0.2 proposal (environment expansion for long-horizon tasks)

**Status: DRAFT, NOT APPROVED. Nothing in this document is built.** `SPEC.md` (v0.1) is unchanged
and stays the source of truth until this proposal is approved, at which point the approved parts
get merged into it.

Open questions are marked **[Q]**. Defaults proposed here are marked *(proposed)*.

Revision 3 (2026-10-04), owner answers:
- Q1 clock speed stays 6x for now. Q2 writers provide prompts plus a rubric (engineers turn rubrics
  into checks). Q3 no pane sync. Q4 per-pane chart settings approved. Q5 news = fictional events
  modeled on real event types, marked simulated. Q6 build multi-chart first (**approved**), then
  decide the rest.
- **Multi-day is back:** at least a second trading day. See §3A (needs approval).

Revision 2 (2026-10-04), per owner feedback:
- LH and Super LH redefined by step count (below).
- Multi-day episodes dropped for now.
- **No tasks are built in v0.2.** The goal is to build out the environment so that **humans write
  the tasks**. v0.2 focuses on features, task-authoring support and grading hooks.
- **Multi-chart layouts are the first feature** (§3).

---

## 1. Goal and horizons

Make chartview rich enough that human task writers can author **LH** and **Super LH** prompts that
need many dependent actions, while keeping v0.1's guarantees: determinism, server-authoritative
clock, no future data in the browser, programmatic grading from state plus the timestamped action
log.

A **step** is one agent action: a click, a scroll, a key press, or one full form entry.

| Horizon | Steps | Episode |
|---|---|---|
| Short | < 40 | part of one session |
| **LH** | **40+** | one session |
| **Super LH** | **100–200** | one session |

All horizons fit inside **one trading session** (09:00–16:30; 75 real minutes at the default 6x).

**[Q1]** At ~5–20 real seconds per agent step, 100–200 steps is roughly 10–60 real minutes, which
fits one session at 6x. Should the clock speed stay 6x for all tasks, or should task writers be able
to choose (e.g. 3x for slower, harder tasks)? *(proposed: per-task choice of 3x / 6x / 12x, default 6x)*

---

## 2. What human task writers need from the environment

Building blocks so writers can author and grade tasks without writing engine code:

1. **Rich, inspectable state:** everything the agent does is persisted server-side and visible in
   `GET /_env/state` (orders, positions, alerts, watchlists, layouts and panes, drawings, journal...).
2. **Complete action log:** every UI-driven change is recorded with `sim_ts` (already true for v0.1
   features; extended to every new feature).
3. **World facts for writers:** a writer-only **World Explorer** on the env port (9090, token-protected)
   showing each seed's planted scenarios, key times and levels, and per-symbol stats (bar values, SMA
   values, volume over windows). Writers use it to choose parameters and correct answers. Never
   reachable from the agent's browser.
4. **Setup:** `reset` accepts a scenario setup (cash, positions, watchlists, alerts, open orders,
   layout, start time) so writers can start an agent in a prepared state.
5. **Grading hooks:** a library of check primitives (position, order, fill window, alert, watchlist,
   layout/pane config, action ordering, rules held for the whole run, typed answer fields) that
   writers combine in a declarative task file. **[Q2]** Will the human writers also write the grading
   checks (in this declarative format), or only the prompt plus a plain-language rubric that engineers
   turn into checks?

---

## 3. P0-1: Multi-chart layouts (first feature): **APPROVED AND BUILT** (merged into SPEC.md §6/§8)

Reference: owner screenshots of the "Layout setup" button and picker. Only these four layouts:

| Layout | Panes | Arrangement |
|---|---|---|
| `1` | 1 | single chart (current) |
| `2` | 2 | side by side (vertical split) |
| `3` | 3 | three columns |
| `4` | 4 | 2×2 grid |

Original styling and icons. The picker shows "1 / 2 / 3 / 4" with a small outline icon for each.

### 3.1 Behavior *(proposed)*
- **Layout setup button** in the top toolbar (square icon, tooltip "Layout setup") opens a small
  menu with the four layouts. The current layout is highlighted.
- **Each pane is a full chart** with its own **symbol, timeframe and indicators**, plus its own
  legend, crosshair, zoom/pan and nav buttons.
- **Active pane:** clicking a pane makes it active (accent border). The toolbar's symbol search,
  timeframe buttons, indicator menu and Alert button act on the active pane. Clicking a watchlist,
  screener or position row loads that symbol into the active pane. The order ticket and Sell/Buy
  boxes use the pane's symbol.
- **Defaults when growing a layout:** new panes start from the active pane's timeframe with the next
  symbols from the current watchlist (writers can override via setup).
- **Shrinking a layout** hides panes 2–4 but **keeps their settings**; switching back restores them.
- **Maximize a pane:** a button in each pane's corner (and double-clicking the pane header) temporarily
  shows that pane full-size; click again to restore the layout.
- **Range bar** (1D/5D/1M/YTD/3M) applies to the active pane.
- **Small panes:** the legend collapses to one line (ticker, timeframe, O/H/L/C) with an expand toggle;
  Sell/Buy boxes are hidden below a minimum pane width.

**[Q3]** Sync options: TradingView can sync crosshair, time range, symbol or interval across panes.
Do you want any sync toggles? *(proposed: none in the first version; add "sync crosshair" and
"sync interval" later if writers need them)*

### 3.2 Server-side state and logging
- New `chart_panes(pane_index 0–3, symbol_id, timeframe, indicators_json)` plus
  `ui_state.layout = "1" | "2" | "3" | "4"` and `ui_state.active_pane`.
- v0.1's per-symbol `chart_prefs` is replaced by per-pane settings *(proposed)*, so a task can say
  "top-right chart shows NVDA on 15m with SMA 50" and be checked exactly.
  **[Q4]** OK to replace per-symbol prefs with per-pane prefs? (Per-symbol memory could stay as the
  default a pane uses when you switch it to a symbol.)
- Every layout change, pane symbol/timeframe/indicator change and active-pane change goes into
  `action_log` with `sim_ts`.
- Pane positions use stable names for grading and testing: `pane-0` top-left/left, `pane-1`
  top-right/second, `pane-2` bottom-left/third, `pane-3` bottom-right.

### 3.3 Live data and leak rules
- The WebSocket subscription becomes a list (up to 4 symbol/timeframe pairs); each tick pushes the
  newest bars for each visible pane. The same no-future-data tests run per pane.

### 3.4 Acceptance
- pytest: pane state persistence, action-log entries, multi-subscription WS frames with no future data.
- Playwright: switch 1→2→3→4→1 (panes restored), set a different symbol and timeframe per pane, active
  pane routing (watchlist click, toolbar, order ticket), maximize/restore, zoom/pan per pane,
  clean console.
- Memory and CPU check with 4 panes on the Render free plan.

---

## 3A. Second trading day: **APPROVED AND BUILT** (merged into SPEC.md §4/§8)

Owner wants at least one more trading day. Proposal:

- **Episode = 1 or 2 sessions** *(proposed; extendable later)*. Day 1 = 2026-01-15, day 2 =
  2026-01-16. Both are generated from the seed at 1-second resolution and revealed progressively.
- **At day 1's 16:30 close:** Day orders are cancelled; positions and cash carry over; day 1's bars
  become history on every chart; "change %" and prior close roll to day 1's close; daily P&L resets.
- **Overnight:** day 2 opens with a seeded overnight gap (planted scenarios can include an overnight
  gap, e.g. news after day 1's close moving a stock at day 2's open).
- **Between days, two options:**
  - **(A) Immediate:** the clock jumps straight from day 1 16:30 to day 2 09:00.
  - **(B) After-hours break** *(recommended)*: a fixed real-time break (default 45 s) showing
    "After hours, next session opens in m:ss". Trading is disabled, but everything else works
    (charts, watchlists, alerts setup, journal). Gives writers a "prepare for tomorrow" phase.
- **Fitting agent budgets:** two full sessions at 6x = 150 real minutes, more than a 100–200-step run
  needs. Tasks can **start late on day 1** (any time, e.g. 14:30), so an episode covers the end of day 1,
  the break and day 2.
- **Sim time:** the clock reports `{day: 1|2, date, time}`; the action log records `day` + `sim_ts`.
  The fixed-step clock can advance across the day boundary.
- **Planted scenarios** spread across both days (and the overnight gap), recorded in world_truth with
  day indexes. Golden hashes are regenerated (intentional change).

**[Q7] Decided (owner, 2026-10-04):** option **B, a short after-hours break** between days, and
episodes are **always 2 days**. Break length proposed at 45 real seconds. **Build not yet started:
waiting for the go-ahead.**

---

## 3B. Line drawing tools: **APPROVED AND BUILT** (first four tools; merged into SPEC.md §6/§8)

Owner request (2026-10-05) with reference screenshots of a line-tools menu and an info line.
Original icons and styling; no copied assets.

### Tools (left toolbar, "Lines" flyout)
| Tool | Placement | What it draws |
|---|---|---|
| Trendline | 2 clicks | segment between two points |
| Ray | 2 clicks | from point 1 through point 2, extended to the right edge |
| **Info line** | 2 clicks | segment plus a live info label (below) |
| Extended line | 2 clicks | line through both points, extended both ways |
| Trend angle | 2 clicks | segment plus an angle arc and degree label |
| Horizontal line | 1 click | full-width line at a price |
| Horizontal ray | 1 click | line from a point to the right edge |
| Vertical line | 1 click | full-height line at a bar |
| Crossline | 1 click | horizontal plus vertical line through a point |

**Info line label** (updates live while drawing or dragging):
- price change: `+46.66 (+0.15%), 4,666` (dollars, percent from the start point, and cents)
- span: `2 bars (2h)` (bar count and time span), plus `distance: 117 px`
- angle: `20.59°` (screen angle, so it depends on zoom, like the reference)

### Behavior *(proposed)*
- **Anchored to data, not pixels:** each point is stored as (bar time, price), so drawings stay
  put through zoom, pan, live updates and timeframe changes.
- **Per symbol:** a drawing belongs to its symbol and shows on every pane and timeframe showing
  that symbol (like the reference product). [Q-D2]
- **Editing:** click a drawing to select it (handles appear); drag a handle to move one point,
  drag the line to move it all; Delete/Backspace removes it; Esc cancels a drawing in progress.
  Toolbar: "Remove all drawings" for the current symbol.
- **Right-side space:** the chart gets empty space to the right of the last bar so points can be
  placed in the future (no data is shown there, so nothing leaks).
- **Magnet (optional):** snap points to the nearest bar's open/high/low/close. [Q-D3]
- **Keyboard shortcuts:** Alt+T trendline, Alt+H horizontal line, Alt+J horizontal ray,
  Alt+V vertical line, Alt+C crossline.
- **Drawings list ("Object list"):** a panel listing each drawing as text: tool, symbol, points
  (date/time and price), and the info line's numbers. Lets agents read exact values and gives
  writers something checkable. [Q-D4]

### State, logging, grading
- `drawings(id, symbol_id, kind, points_json, created_sim_ts, updated_sim_ts)`; all four views are
  in `/_env/state`. Every create, move and delete is in `action_log` with `sim_ts`.
- Rubrics can then say e.g. "draw an info line on AAPL from the Jan 15 10:00 5m bar low to the
  11:00 bar high" or "mark day 1's high with a horizontal line before day 2 opens", checked with a
  price/time tolerance.
- Price change and % for the info line are computed server-side from the stored points too (the
  same numbers the label shows), so they're available to graders.

### Decisions (owner, 2026-10-05)
- **[Q-D1]** First version: **Info line, Trendline, Horizontal line, Vertical line.** Ray, Extended
  line, Trend angle, Horizontal ray and Crossline come later.
- **[Q-D2]** **Per symbol** (shared across panes and timeframes).
- **[Q-D3]** **Magnet included**, a toggle that is off by default.
- **[Q-D4]** **Drawings list panel included.**

---

## 4. Further environment features (candidates, after multi-chart)

Each needs your approval before it's built. Items marked ⚠ reverse a v0.1 non-goal (SPEC §1).

- **P0-2 Synthetic news feed** ⚠: timestamped headlines published at scheduled sim times (linked to
  planted scenarios, decoys, sector items). Nothing visible before publish time. **[Q5]** Since tickers
  are real: clearly fictional events plus a "Simulated" marker, or sector-level news only?
- **P0-3 Inbox:** messages from roles ("Risk desk", "PM") delivered at sim times; optional acknowledge.
  Lets writers change goals mid-episode.
- **P0-4 Advanced orders:** bracket (entry + stop + target), OCO, trailing stop, modify working order.
- **P0-5 Risk rules page:** max position, max gross exposure, max daily loss, restricted list; per-task
  `soft` (logged violation) or `hard` (rejected) enforcement.
- **P0-6 Journal and structured report:** journal entries linked to orders and tags; a report form with
  typed fields defined by the task.
- **P1-1 Drawing tools** ⚠: horizontal level, trendline, text label; saved per pane/symbol; gradable.
- **P1-2 Indicator and volume alerts:** price vs SMA, SMA cross, volume spike.
- **P1-3 Screener v2:** custom time windows, saved screens, relative volume column.
- **P1-4 Configurable clock speed** (see [Q1]).
- **P2:** sector heatmap, portfolio analytics page, CSV export, undo/redo for chart settings.

**[Q6]** After multi-chart, which of these next, and in what order?

---

## 5. Fixes to include (from the v0.1 audit)

1. **Docker mode switch:** `CHARTVIEW_MODE=env|demo` so `docker run -p 8080:8080 -p 9090:9090` gives the
   full harness environment (SPEC §14) while Render keeps demo mode.
2. **History tab:** add round-trip closed trades (entry, exit, P&L), as SPEC §6 says.

---

## 6. Build order (each step stops for review)

1. Multi-chart layouts (§3) + the two fixes (§5).
2. Task-authoring support (§2): World Explorer, extended setup, check-primitive library and task-file
   format (depends on [Q2]).
3. Next features in the order chosen in [Q6].

---

## 7. Open questions (summary)

- **[Q1]** Clock speed: fixed 6x, or per-task 3x/6x/12x?
- **[Q2]** Do human writers also write the grading checks, or only prompts plus a rubric?
- **[Q3]** Any sync options across panes in the first version?
- **[Q4]** Replace per-symbol chart prefs with per-pane prefs?
- **[Q5]** News content with real tickers: fictional events plus marker, or sector-level only?
- **[Q6]** Feature order after multi-chart. (Owner: decide after multi-chart is built.)
- **[Q7]** Decided: short after-hours break; always 2 days.
