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

async function addIndicator(page: import("@playwright/test").Page, type: string, params: Record<string, number> = {}) {
  for (const [name, v] of Object.entries(params)) await page.getByTestId(`${type}-${name}`).fill(String(v));
  await page.getByTestId(`add-${type}`).click();
}

test("add every indicator from the menu; legend values match the grader's numbers", async ({ app, env, request }) => {
  await env.advance(3 * 3600);
  await waitForClock(app, "12:00:00");
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  const tf = (await app.getByTestId("legend-timeframe").textContent())!;

  await app.getByTestId("indicators-button").click();
  await addIndicator(app, "ema", { period: 9 });
  await addIndicator(app, "bb");
  await addIndicator(app, "vwap");
  await addIndicator(app, "rsi", { period: 14 });
  await addIndicator(app, "macd");
  await addIndicator(app, "kdj");
  await app.getByTestId("indicators-button").click();

  for (const key of ["rsi-14", "macd-12-26-9", "kdj-9-3-3"]) await expect(app.getByTestId(`lower-${key}`)).toBeVisible();
  for (const key of ["ema-9", "bb-20-2", "vwap"]) await expect(app.getByTestId(`overlay-${key}`)).toBeVisible();

  const checks: [string, object, string][] = [
    ["legend-ema-9", { type: "ema", period: 9 }, "ema"],
    ["legend-bb-20-2-upper", { type: "bb" }, "upper"],
    ["legend-bb-20-2-lower", { type: "bb" }, "lower"],
    ["legend-vwap", { type: "vwap" }, "vwap"],
    ["legend-rsi-14", { type: "rsi", period: 14 }, "rsi"],
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

  const lay = await (await request.get("/api/layout")).json();
  expect(lay.panes[0].indicators).toEqual([
    { type: "volume" },
    { type: "ema", period: 9 },
    { type: "bb", period: 20, stddev: 2 },
    { type: "vwap" },
    { type: "rsi", period: 14 },
    { type: "macd", fast: 12, slow: 26, signal: 9 },
    { type: "kdj", period: 9, k: 3, d: 3 },
  ]);
});

test("indicator limits and validation are explained; indicators can be removed", async ({ app, request }) => {
  await app.getByTestId("indicators-button").click();
  await addIndicator(app, "rsi");
  await addIndicator(app, "rsi");
  await expect(app.getByTestId("indicator-error")).toHaveText("RSI 14 is already on this chart.");
  await addIndicator(app, "rsi", { period: 7 });
  await addIndicator(app, "macd");
  await addIndicator(app, "kdj");
  await expect(app.getByTestId("indicator-error")).toHaveText("At most 3 lower panes (RSI, MACD, KDJ) per chart.");
  await addIndicator(app, "ema", { period: 0 });
  await expect(app.getByTestId("indicator-error")).toContainText("from 1 to 500");
  await addIndicator(app, "macd", { fast: 30, slow: 20 });
  await expect(app.getByTestId("indicator-error")).toHaveText("MACD fast length must be shorter than slow length.");

  await app.getByTestId("remove-rsi-7").click();
  await expect(app.getByTestId("lower-rsi-7")).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get("/api/layout")).json()).panes[0].indicators.map((i: { type: string }) => i.type))
    .toEqual(["volume", "rsi", "macd"]);
});

test("indicators stay with their pane in a multi-chart layout", async ({ app, request }) => {
  await app.getByTestId("layout-button").click();
  await app.getByTestId("layout-option-2").click();
  await app.getByTestId("pane-1").click({ position: { x: 200, y: 200 } });
  await app.getByTestId("indicators-button").click();
  await addIndicator(app, "rsi");
  await app.getByTestId("indicators-button").click();
  await expect(app.getByTestId("pane-1").getByTestId("lower-rsi-14")).toBeVisible();
  await expect(app.getByTestId("pane-0").getByTestId("lower-rsi-14")).toHaveCount(0);
  const lay = await (await request.get("/api/layout")).json();
  expect(lay.panes[1].indicators).toContainEqual({ type: "rsi", period: 14 });
});
