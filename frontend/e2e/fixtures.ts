import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { ENV_PORT, ENV_TOKEN } from "../playwright.config";

const ENV = `http://127.0.0.1:${ENV_PORT}`;
const HEADERS = { "X-Env-Token": ENV_TOKEN };

/**
 * Things that must never reach the agent-facing browser: the truth file, the env API, and
 * world_truth's keys. Case-sensitive and word-bounded, since truth keys are snake_case and
 * library code contains innocent identifiers such as "BreakOutward".
 */
export const FORBIDDEN: RegExp[] = [
  /world_truth/,
  /\/_env\b/,
  /\bscenarios?\b/,
  /\bbreakout\b/,
  /\bfakeout\b/,
  /\bsharp_drop\b/,
  /\bvolume_surge\b/,
  /\bspike\b/,
  /\bt[1-4]_sec\b/,
  /\bprior_day_high_cents\b/,
  /\blevel_cents\b/,
  /"roles"/,
  /"attempt"/,
];

export class Env {
  constructor(private request: APIRequestContext) {}

  async reset(opts: { seed?: number; start_time?: string; setup?: unknown } = {}, start = true) {
    const r = await this.request.post(`${ENV}/_env/reset`, {
      headers: HEADERS,
      data: { seed: 1234, clock_mode: "fixed-step", ...opts },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    if (start) {
      const s = await this.request.post(`${ENV}/_env/start`, { headers: HEADERS });
      expect(s.ok()).toBeTruthy();
    }
  }

  async advance(simSeconds: number) {
    const r = await this.request.post(`${ENV}/_env/clock/advance`, {
      headers: HEADERS,
      data: { sim_seconds: simSeconds },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()) as { sim_now: number; time: string };
  }

  async state() {
    const r = await this.request.get(`${ENV}/_env/state`, { headers: HEADERS });
    return (await r.json()) as { sim_now: number; tables: Record<string, Record<string, unknown>[]> };
  }
}

type Fixtures = {
  env: Env;
  /** Console messages (error/warning) and page errors collected during the test. */
  consoleProblems: string[];
  /** Patterns of console errors a specific test expects (e.g. a deliberate 409). */
  allowConsole: RegExp[];
  app: Page;
};

export const test = base.extend<Fixtures>({
  env: async ({ request }, use) => {
    await use(new Env(request));
  },
  allowConsole: [[], { option: true }],
  consoleProblems: async ({ page, allowConsole }, use) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !allowConsole.some((re) => re.test(m.text())))
        problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await use(problems);
    expect(problems, "browser console must stay clean").toEqual([]);
  },
  app: async ({ page, env, consoleProblems }, use) => {
    void consoleProblems; // activate the console guard for every test using `app`
    await env.reset();
    await page.goto("/");
    await expect(page.getByTestId("clock-time")).toHaveText("09:00:00");
    await expect(page.getByTestId("legend-c")).toBeVisible();
    await use(page);
  },
});

export { expect };

/** Waits for the UI clock to show `time` (the server pushes one frame per real second). */
export async function waitForClock(page: Page, time: string) {
  await expect(page.getByTestId("clock-time")).toHaveText(time, { timeout: 5000 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Expected legend time text: "Jan 15 10:05", or "Jan 15, 2026" for daily bars. */
export function legendTime(b: { date: string; label: string }, daily = false): string {
  const [y, m, d] = b.date.split("-");
  const day = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return daily ? `${day}, ${y}` : `${day} ${b.label}`;
}

/** The chart's visible bar window [start, end] (indices into the bars array). */
export async function chartWindow(page: Page): Promise<[number, number]> {
  const w = await page.getByTestId("chart-canvas").getAttribute("data-window");
  const [a, b] = (w ?? "0-0").split("-").map(Number);
  return [a, b];
}
