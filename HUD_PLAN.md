# HUD integration plan (test integration): DRAFT, awaiting approval

Goal: expose chartview through the HUD SDK as a computer-use rollout environment (the agent acts
through the browser GUI with screenshots), without changing the core engine or GUI. The adapter lives
in `hud_adapter/`; the core never imports it.

---

## 0. Research summary (HUD as of 2026-10-05)

| Topic | Finding |
|---|---|
| Package | **`hud` 0.6.18** on PyPI (2026-09-20), renamed from `hud-python` (abandoned at 0.6.10). Main branch is 0.6.19.dev2. MIT. Python `>=3.11,<3.13`, so our 3.12 works. |
| Big change | **v6 is a breaking redesign.** Environments are no longer MCP servers; `MCPServer`, `@env.tool`, `HudComputerTool`, `setup_tool/evaluate_tool`, and `hud build/push/dev` are all gone. |
| Environment API | `env = Environment(name="chartview", version=...)`, plus `@env.initialize`/`@env.shutdown` hooks (once per container). Served by `hud serve env.py --port 8765` as a **control channel**: newline-delimited JSON-RPC on one TCP port (`tasks.list/start/grade`). |
| Tasks / grading | A task is an `@env.template(...)` async generator with **two yields**. Code before the first yield is setup; it yields the prompt. Then it receives the agent's answer, grades, and yields the reward. `Task` rows (env, id, args, agent_config like `max_steps`) are grouped into a `Taskset`. |
| Rewards | A `float` 0–1, or `EvaluationResult(reward, done, subscores=[SubScore(name, value, weight)], info, content)`. Partial credit through weighted subscores. |
| Computer use | The env publishes an **`rfb` (VNC) capability**: Xvfb + x11vnc + Chromium on the X display (reference image `hud init x --template cua`). Agent-side `ClaudeComputerTool`/`OpenAIComputerTool` drive VNC; the coordinate space is the framebuffer (keep ≤1280×800 for Claude, no rescaling). The browser connects simply by being on that display. |
| Per-step hooks | **None.** The env never sees individual actions; the agent sends raw VNC input through a tunnel. |
| Local runs | `hud eval tasks.py claude --runtime docker --max-concurrent N`, or `await taskset.run(agent, runtime=DockerRuntime(image), group=..., max_concurrent=...)`. `DockerRuntime` = a fresh container per rollout, publishing only the control port on localhost. **No HUD key needed for local runs**, only a model key (e.g. `ANTHROPIC_API_KEY`). |
| Training | Managed RL (`TrainingClient`, Tinker/LoRA, GRPO via `group=`) captures tokens only through `OpenAIChatAgent`, **which has no computer tool**. So managed RL on a screenshot/mouse env isn't supported out of the box; labs would export `reward` + trace per run to their own trainer. |
| Keys | `HUD_API_KEY` is needed for: the gateway, the hud.ai trace viewer, `hud deploy`, hosted runtimes, managed training, and the LLM-judge grader. Not needed for local Docker runs. **With a HUD key, traces (including screenshots) upload to hud.ai**; `HUD_TELEMETRY_ENABLED=0` keeps them local. Prices aren't published (shown in-app only). |
| Marketplace | `hud deploy` builds remotely from `Dockerfile.hud` and registers the env (**private by default**). "Make public" lists it in the catalog (owner/admin, successful build). Tasksets publish with `hud sync tasks`. **No review process, listing requirements or licence terms are documented.** |

Sources: github.com/hud-evals/hud-python (HEAD 9e916fa, 2026-10-03; `docs/v6/...`), docs.hud.ai,
pypi.org/project/hud.

---

## 1. Conflicts and gaps to resolve first

1. **There is no task registry, verifier set, oracle solver or harness yet.** We paused Stages 3–4
   when you chose human-written tasks, and `/_env/grade` returns 501. Step 3 needs two graded tasks,
   so something must be built. **Proposal:** a minimal core task framework (`app/tasks/`) with the two
   tasks, their verifiers, oracle solvers and positive/negative/late tests, plus `/_env/grade`
   implemented. This is new core code (not a change to the engine or GUI), and both the
   standalone harness and HUD would call it. **[Decision A]**
2. **The in-container browser can reach `127.0.0.1:9090`.** In HUD's model, Chromium runs inside the
   same container, and the token is the only barrier. **Proposal:** run the env API on a **Unix
   socket** owned by the HUD server's user (a `--env-uds` option in `app/main.py`, a server option,
   not engine logic). Chromium runs as an unprivileged user that can't open the socket or read
   `data/` (so `file:///…/world_truth.json` is unreadable too). No CDP port, and kiosk mode with a
   URL allowlist of `http://127.0.0.1:8080` only. **[Decision B]**
3. **No per-step hook exists, but we want "fixed sim-time per step".** See §4. **[Decision C]**
4. **Speed vs steps.** SPEC §4 says "speed is part of the skill". In HUD mode, time advances per
   action, so **steps become the cost** instead of wall-clock speed. This applies to the HUD mode
   only; the standalone harness keeps real time.
5. **Screen size.** Our UI was designed at 1600×900. HUD/Claude want ≤1280×800, which squeezes the
   sidebar and order ticket. We'd verify the layout at 1280×800. If it's cramped, fix it with the
   existing panel widths (no GUI redesign), or accept it.
6. **Telemetry.** With `HUD_API_KEY` set, screenshots and tool results upload to hud.ai. The data is
   synthetic, but `world_truth` must never appear in prompts, grade `info` or `content` (which also
   upload). Default **`HUD_TELEMETRY_ENABLED=0`** for our test runs unless you want traces in hud.ai.
   **[Decision D]**
7. **Managed RL won't work as-is for computer use** (see §0). Fine for this test; flag for labs.
8. **Marketplace:** real tickers plus a public listing reopens the legal question from SPEC §2. Keep
   the environment **private** for now.

---

## 2. Mapping onto HUD

| chartview | HUD |
|---|---|
| Container running FastAPI (8080 app, env API) + Xvfb + x11vnc + kiosk Chromium at `http://127.0.0.1:8080` | One HUD environment image (`hud_adapter/Dockerfile.hud`, built **on top of** our existing image) |
| `/_env/reset` + `start` (seed, start day/time, setup, `fixed-step`) | Template body **before the first yield** (called over the Unix socket) |
| Task registry entry (`app/tasks/…`: prompt template, params from world, setup, verifier) | `@env.template(id="buy_market")`, `@env.template(id="bar_close_lookup")`; tasks are `Task` rows in `hud_adapter/tasks.py` (seeds × tasks) |
| Verifier (`/_env/grade` → `{reward, checks, passed}`) | After the first yield: call grade with the agent's answer, then yield `EvaluationResult(reward, subscores=[one SubScore per check], info={"passed": …})`, **never with truth values** |
| Action log with `sim_ts` | Unchanged: the GUI's API calls are logged by the core. HUD's trace additionally logs each tool step. |
| Screen | `Capability.rfb(name="screen", url="rfb://127.0.0.1", display=0)`, Xvfb 1280×800×24 |

The core stays standalone: `hud_adapter/` has its own `pyproject.toml` (pinning `hud==0.6.18`) and
Dockerfile, and only talks to the app over HTTP and the Unix socket. A test will grep `app/` for
`hud_adapter` and `import hud` to enforce that.

---

## 3. Observation and reward

- **Observation:** the VNC framebuffer at a **fixed 1280×800**. The UI already shows sim time, date,
  "Day N of 2" and market status as on-screen text (toolbar + range bar).
  - To also give these as **machine text**, the only HUD channel besides the screen is an `mcp`
    capability, and built-in agents automatically hand every MCP tool to the model.
  - **Option:** one read-only tool, `market_clock()` → `{sim_time, day, market_status}` (no other
    state). The catch: calling it costs the agent a step.
  - **Alternative:** include the starting sim time and status in the prompt only, and rely on the
    on-screen clock after that. **[Decision E]**
- **Reward:** the verifier score (0–1, partial credit by checks) at episode end, computed by the core
  verifier through `/_env/grade`, so the HUD reward equals the standalone harness reward for the same
  final state and action log.

---

## 4. Clock: fixed sim-time per step

**What we want:** each agent action advances the sim clock by `SIM_SECONDS_PER_STEP` (default **30
sim s**, configurable per task), using our existing `fixed-step` clock. Rollouts are then
deterministic and independent of model latency.

**How, given that HUD has no step hook.** Two options:
- **(C1, recommended) An env-side VNC proxy** in `hud_adapter/`, between the HUD tunnel and x11vnc:
  - It forwards bytes unchanged.
  - When it sees the first **screenshot request after any input** (or a screenshot request with no
    input since the last one, i.e. a "wait"), it calls `clock/advance(SIM_SECONDS_PER_STEP)`, waits for
    the UI to repaint, then lets the screenshot through.
  - It logs each step (count, inputs, `sim_ts`) to the action log through the env API.
  - **Pro:** works for any agent or lab harness. **Con:** VNC traffic doesn't map exactly 1:1 to
    model actions, so step detection needs a spike to validate against `ClaudeComputerTool`'s
    pattern (act, then screenshot).
- **(C2) A harness-side agent wrapper:** subclass `ClaudeAgent` and advance the clock in the tool
  dispatch.
  - **Pro:** exactly one advance per model action.
  - **Con:** relies on a private SDK method (`_dispatch_call`), only works with our own agent loop,
    and external labs' agents wouldn't advance the clock at all.

**Tradeoff (fixed step vs real time):**
- **Fixed step:** reproducible and fair across models of different latency; cheap to replay; scores
  don't depend on API speed. But "speed" becomes "number of actions", agents can't burn time by
  thinking, and timed tasks are effectively measured in steps.
- **Real time:** more realistic time pressure, but rewards then vary with model latency, network
  jitter and hardware, and parallel rollouts slow each other down.
- **Plan:** fixed-step for HUD rollouts; real-time stays the default for the standalone harness and
  the Render demo.

---

## 5. Containers, reset time, parallelism

- **One container per episode** (`DockerRuntime`, fresh container per rollout; HUD's cua template also
  refuses a second task per container).
- **Reset-time targets:**
  - Container up to "HUD ready" in **≤15 s** (Xvfb + Chromium + app start).
  - Task setup in **≤3 s** (world build ~1–2 s, plus reset/start and UI reload).
  - The default seeds' world DBs could be pre-built into the image if needed.
- **Parallel rollouts** via `max_concurrent`. Expected ~1 GB RAM per container (app ~250 MB + Chromium
  + Xvfb); measured in Step 3.

---

## 6. Leak rules (unchanged), and how they hold in HUD

- **No `world_truth` reachable by the agent.** It isn't on screen, isn't in prompts or grade
  `info`/`content`, and its files are unreadable by the browser user.
- **No `/_env` access from the agent's browser** (Unix socket + user separation; §1.2). Only the
  `rfb` capability is published. **The env API is never exposed as an `mcp` capability.**
- **Every action logged with `sim_ts`:** the core logs every GUI-driven API call; the proxy (C1) adds
  per-step entries.
- **Leak audit:** the existing pytest/Playwright audits, plus a new check run *inside the HUD container*
  that the browser user can't reach the socket or read `data/`, and that no `9222`/`9090` TCP ports are
  listening.

---

## 7. Secrets

- `HUD_API_KEY` and model keys (`ANTHROPIC_API_KEY`) are read **only from environment variables**:
  never hardcoded, printed or committed.
- `.env` is already gitignored. A pre-commit check will grep staged files for key patterns.
- Keys are never passed into the environment container, which doesn't need them; the agent runs on
  the host.

---

## 8. Step 3 (after approval): two tasks only

1. **T1 `buy_market`:** "Buy {qty} shares of {ticker} at market." Checks: a filled market buy for
   that ticker/qty, the fill within the spread at fill time, and no other orders.
2. **T2 `bar_close_lookup`:** "What was {ticker}'s 1-minute bar close at {HH:MM} on Jan 15?" The task
   starts after that time; the agent answers in text. Check: a numeric match to the cent.

**Then:**
- **Oracle solvers:**
  - **API oracle:** runs in the standalone path.
  - **GUI oracle through HUD:** a scripted HUD agent sends computer-tool clicks/keys at coordinates
    measured once at 1280×800.
- **Grade parity:** confirm both give reward 1.0 and identical checks for the same actions, and that
  the negatives (wrong qty/answer, late answer) score below 1.0 through HUD as well.
- **Audits:** the leak audit (§6).
- **One real model rollout** per task with Claude via `hud eval … --runtime docker`. This needs
  `ANTHROPIC_API_KEY` in your shell; I'll ask before spending.
- **Report:** reset time, step latency (per action incl. clock advance), tokens and cost per episode,
  and HUD friction.

---

## 9. Decisions needed

- **A.** Build a minimal core task framework (2 tasks, verifiers, oracles, tests, `/_env/grade`)? *(recommended)*
- **B.** Serve the env API on a Unix socket in HUD mode, with browser-user isolation? *(recommended)*
- **C.** Step clock via the env-side VNC proxy (C1), or the agent wrapper (C2)? *(C1 recommended; C2 as fallback)*
- **D.** Keep HUD telemetry off (`HUD_TELEMETRY_ENABLED=0`) for test runs? *(recommended)*
- **E.** Clock/status as text: a read-only `market_clock` tool, or prompt + on-screen only? *(prompt + on-screen recommended, to keep step counts honest)*
