import { type APIRequestContext } from "@playwright/test";
import { ENV_PORT, ENV_TOKEN } from "../playwright.config";
import { expect, test, waitForClock } from "./fixtures";

const ENV = `http://127.0.0.1:${ENV_PORT}`;

/** Latest-bar values from the harness (same formulas the graders use). */
async function serverLast(request: APIRequestContext, ticker: string, tf: string, indicator: object) {
  const r = await request.post(`${ENV}/_env/indicators`, {
    headers: { "X-Env-Token": ENV_TOKEN },
    data: { ticker, timeframe: tf, indicator },
  });
  return (await r.json()).bars.at(-1) as Record<string, number | null>;
}

const money = (n: number) =>
  (Math.abs(n) < 0.005 ? 0 : n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paneIndicators = async (request: APIRequestContext, pane = 0) =>
  (await (await request.get("/api/layout")).json()).panes[pane].indicators;

test("one click adds an indicator with standard settings and confirms it", async ({ app, env, request }) => {
  await env.advance(3 * 3600);
  await waitForClock(app, "12:00:00");
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  const tf = (await app.getByTestId("legend-timeframe").textContent())!;

  await app.getByTestId("indicators-button").click();
  for (const t of ["ema", "bb", "vwap", "rsi", "macd", "kdj"]) await app.getByTestId(`add-${t}`).click();
  await expect(app.getByTestId("toast-success").first()).toHaveText(/Indicator added to chart/);
  await app.getByTestId("indicators-button").click();

  await expect
    .poll(() => paneIndicators(request))
    .toEqual([
      { type: "volume" },
      { type: "ema", period: 20 },
      { type: "bb", period: 20, stddev: 2 },
      { type: "vwap" },
      { type: "rsi", period: 14 },
      { type: "macd", fast: 12, slow: 26, signal: 9 },
      { type: "kdj", period: 9, k: 3, d: 3 },
    ]);
  for (const key of ["rsi-14", "macd-12-26-9", "kdj-9-3-3"]) await expect(app.getByTestId(`lower-${key}`)).toBeVisible();

  const checks: [string, object, string][] = [
    ["legend-ema-20", { type: "ema", period: 20 }, "ema"],
    ["legend-bb-20-2-upper", { type: "bb" }, "upper"],
    ["legend-bb-20-2-lower", { type: "bb" }, "lower"],
    ["legend-vwap", { type: "vwap" }, "vwap"],
    ["legend-rsi-14", { type: "rsi" }, "rsi"],
    ["legend-macd-12-26-9-macd", { type: "macd" }, "macd"],
    ["legend-macd-12-26-9-signal", { type: "macd" }, "signal"],
    ["legend-kdj-9-3-3-k", { type: "kdj" }, "k"],
    ["legend-kdj-9-3-3-d", { type: "kdj" }, "d"],
    ["legend-kdj-9-3-3-j", { type: "kdj" }, "j"],
  ];
  for (const [testId, ind, field] of checks) {
    const v = (await serverLast(request, ticker, tf, ind))[field] as number;
    await expect(app.getByTestId(testId), `${testId} vs server ${field}`).toHaveText(money(v));
  }
});

test("menu search, and errors for duplicates and too many panes", async ({ app }) => {
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("indicator-search").fill("bollinger");
  await expect(app.getByTestId("indicators-menu").getByRole("button")).toHaveCount(1);
  await app.getByTestId("indicator-search").fill("");
  await app.getByTestId("add-rsi").click();
  await app.getByTestId("add-rsi").click();
  await expect(app.getByTestId("toast-error")).toContainText("RSI 14 is already on this chart.");
  await app.getByTestId("add-macd").click();
  await app.getByTestId("add-kdj").click();
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("study-rsi-14").click();
  await app.getByTestId("study-settings-rsi-14").click();
  await app.getByTestId("settings-period").fill("7");
  await app.getByTestId("settings-apply").click();
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("add-rsi").click(); // a 4th lower pane
  await expect(app.getByTestId("toast-error").last()).toContainText("At most 3 lower panes");
});

test("click an indicator on the chart to hide, edit or remove it", async ({ app, request }) => {
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("add-macd").click();
  await app.getByTestId("indicators-button").click();
  const row = app.getByTestId("study-macd-12-26-9");
  await expect(app.getByTestId("study-settings-macd-12-26-9")).toBeHidden(); // actions show on hover/click
  await row.click();
  await expect(app.getByTestId("study-settings-macd-12-26-9")).toBeVisible();

  await app.getByTestId("study-hide-macd-12-26-9").click();
  await expect(row).toHaveAttribute("data-hidden", "true");
  await expect(app.getByTestId("legend-macd-12-26-9-macd")).toHaveCount(0);
  await expect.poll(() => paneIndicators(request)).toContainEqual({ type: "macd", fast: 12, slow: 26, signal: 9, hidden: true });
  await row.click();
  await app.getByTestId("study-hide-macd-12-26-9").click();
  await expect(row).toHaveAttribute("data-hidden", "false");

  await row.click();
  await app.getByTestId("study-settings-macd-12-26-9").click();
  await expect(app.getByTestId("indicator-settings")).toBeVisible();
  await app.getByTestId("settings-fast").fill("30");
  await app.getByTestId("settings-apply").click();
  await expect(app.getByTestId("settings-error")).toHaveText("MACD fast length must be shorter than slow length.");
  await app.getByTestId("settings-fast").fill("8");
  await app.getByTestId("settings-signal").fill("5");
  await app.getByTestId("settings-apply").click();
  await expect(app.getByTestId("indicator-settings")).toHaveCount(0);
  await expect(app.getByTestId("study-macd-8-26-5")).toBeVisible();
  await expect.poll(() => paneIndicators(request)).toContainEqual({ type: "macd", fast: 8, slow: 26, signal: 5 });

  await app.getByTestId("study-macd-8-26-5").click();
  await app.getByTestId("study-remove-macd-8-26-5").click();
  await expect(app.getByTestId("lower-macd-8-26-5")).toHaveCount(0);
  await expect.poll(() => paneIndicators(request)).toEqual([{ type: "volume" }]);
});

test("indicators stay with their pane in a multi-chart layout", async ({ app, request }) => {
  await app.getByTestId("layout-button").click();
  await app.getByTestId("layout-option-2").click();
  await app.getByTestId("pane-1").click({ position: { x: 200, y: 200 } });
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("add-rsi").click();
  await app.getByTestId("indicators-button").click();
  await expect(app.getByTestId("pane-1").getByTestId("lower-rsi-14")).toBeVisible();
  await expect(app.getByTestId("pane-0").getByTestId("lower-rsi-14")).toHaveCount(0);
  expect(await paneIndicators(request, 1)).toContainEqual({ type: "rsi", period: 14 });
});
