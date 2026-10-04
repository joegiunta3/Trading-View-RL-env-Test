import { chartWindow, expect, legendTime, test, waitForClock } from "./fixtures";

type Bar = { date: string; label: string; o: number; h: number; l: number; c: number; v: number };

async function bars(request: import("@playwright/test").APIRequestContext, t: string, tf: string): Promise<Bar[]> {
  return (await (await request.get(`/api/bars/${t}?tf=${tf}`)).json()).bars;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test("legend shows the latest bar as text", async ({ app, env, request }) => {
  await env.advance(3 * 3600);
  await waitForClock(app, "12:00:00");
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  const tf = (await app.getByTestId("legend-timeframe").textContent())!;
  const last = (await bars(request, ticker, tf)).at(-1)!;
  await expect(app.getByTestId("legend-time")).toHaveText(legendTime(last));
  await expect(app.getByTestId("legend-c")).toHaveText(money(last.c));
  await expect(app.getByTestId("legend-h")).toHaveText(money(last.h));
  await expect(app.getByTestId("legend-vol")).toHaveText(last.v.toLocaleString("en-US"));
});

test("symbol search switches the chart and persists server-side", async ({ app, request }) => {
  await app.getByTestId("symbol-search").fill("micro");
  await expect(app.getByTestId("symbol-option-MSFT")).toBeVisible();
  await app.getByTestId("symbol-search").press("Enter");
  await expect(app.getByTestId("legend-ticker")).toHaveText("MSFT");
  await expect.poll(async () => (await (await request.get("/api/ui_state")).json()).active_symbol).toBe("MSFT");
  await app.reload();
  await expect(app.getByTestId("legend-ticker")).toHaveText("MSFT");
});

test("timeframe and SMA settings are saved and computed correctly", async ({ app, env, request }) => {
  await env.advance(6 * 3600);
  await waitForClock(app, "15:00:00");
  await app.getByTestId("symbol-search").fill("XOM");
  await app.getByTestId("symbol-search").press("Enter");
  await expect(app.getByTestId("legend-ticker")).toHaveText("XOM");

  await app.getByTestId("tf-15m").click();
  await expect(app.getByTestId("tf-15m")).toHaveAttribute("aria-pressed", "true");
  await expect(app.getByTestId("legend-timeframe")).toHaveText("15m");

  await app.getByTestId("indicators-button").click();
  await app.getByTestId("sma-period").fill("20");
  await app.getByTestId("add-sma").click();
  await app.getByTestId("indicators-button").click();

  await expect
    .poll(async () => (await request.get("/api/chart_prefs/XOM")).json())
    .toEqual({ ticker: "XOM", timeframe: "15m", indicators: [{ type: "volume" }, { type: "sma", period: 20 }] });

  const closes = (await bars(request, "XOM", "15m")).map((b) => b.c);
  const expected = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  await expect(app.getByTestId("legend-sma-20")).toHaveText(money(Math.round(expected * 100) / 100));

  await app.reload();
  await expect(app.getByTestId("legend-timeframe")).toHaveText("15m");
  await expect(app.getByTestId("legend-sma-20")).toBeVisible();
});

test("volume can be toggled off", async ({ app, request }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("toggle-volume").uncheck();
  await expect(app.getByTestId("legend-vol")).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`/api/chart_prefs/${ticker}`)).json()).indicators)
    .toEqual([]);
});

test("hovering the chart shows that bar in the legend; zoom tools work", async ({ app, env }) => {
  await env.advance(2 * 3600);
  await waitForClock(app, "11:00:00");
  await expect(app.getByTestId("legend-time")).toHaveText("Jan 15 11:00");
  const box = (await app.getByTestId("chart-canvas").boundingBox())!;
  await app.mouse.move(box.x + 60, box.y + box.height / 2);
  await expect(app.getByTestId("legend-time")).not.toHaveText("Jan 15 11:00");
  await app.mouse.move(box.x + box.width + 50, box.y - 100);
  await expect(app.getByTestId("legend-time")).toHaveText("Jan 15 11:00");
  for (const tool of ["tool-zoom-in", "tool-zoom-out", "tool-reset-view", "tool-crosshair"]) {
    await app.getByTestId(tool).click();
  }
  await expect(app.getByTestId("tool-crosshair")).toHaveAttribute("aria-pressed", "false");
});

test("daily timeframe shows prior sessions", async ({ app, request }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  await app.getByTestId("tf-1D").click();
  const daily = await bars(request, ticker, "1D");
  expect(daily).toHaveLength(61);
  await expect(app.getByTestId("legend-time")).toHaveText(legendTime(daily.at(-1)!, true));
});

test("intraday charts include prior sessions, even at the open", async ({ app, request }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  for (const tf of ["1m", "5m", "15m", "1h"]) {
    await app.getByTestId(`tf-${tf}`).click();
    const all = await bars(request, ticker, tf);
    expect(all.filter((b) => b.date !== "2026-01-15").length).toBeGreaterThan(400);
    await expect(app.getByTestId("chart-canvas")).toHaveAttribute("data-bars", String(all.length));
    const [start, end] = await chartWindow(app);
    expect(end).toBe(all.length - 1);
    expect(end - start + 1).toBeGreaterThanOrEqual(100); // a full screen of candles
  }
});

test("zoom and scroll with on-chart buttons, the left rail and the keyboard", async ({ app }) => {
  await app.getByTestId("tf-5m").click();
  await expect(app.getByTestId("chart-canvas")).toHaveAttribute("data-bars", /\d{3,}/);
  const [s0, e0] = await chartWindow(app);

  await app.getByTestId("chart-zoom-in").click();
  await expect.poll(async () => { const [s, e] = await chartWindow(app); return e - s; }).toBeLessThan(e0 - s0);
  await app.getByTestId("chart-zoom-out").click();
  await app.getByTestId("chart-zoom-out").click();
  await expect.poll(async () => { const [s, e] = await chartWindow(app); return e - s; }).toBeGreaterThan(e0 - s0);

  const [, e1] = await chartWindow(app);
  await app.getByTestId("chart-pan-left").click();
  await expect.poll(async () => (await chartWindow(app))[1]).toBeLessThan(e1);
  const [, e2] = await chartWindow(app);
  await app.getByTestId("tool-pan-left").click();
  await expect.poll(async () => (await chartWindow(app))[1]).toBeLessThan(e2);

  const [, e3] = await chartWindow(app);
  await app.getByTestId("chart").focus();
  await app.keyboard.press("ArrowRight");
  await expect.poll(async () => (await chartWindow(app))[1]).toBeGreaterThan(e3);
  await app.keyboard.press("-");
  await app.keyboard.press("0");
  await expect.poll(async () => (await chartWindow(app))[1]).toBe(e0);
});

test("range presets switch timeframe and window", async ({ app, request }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  await app.getByTestId("range-5D").click();
  await expect(app.getByTestId("tf-15m")).toHaveAttribute("aria-pressed", "true");
  const all = await bars(request, ticker, "15m");
  const dates = [...new Set(all.map((b) => b.date))];
  const firstIdx = all.findIndex((b) => b.date === dates[dates.length - 5]);
  await expect.poll(async () => (await chartWindow(app))[0]).toBe(firstIdx);

  await app.getByTestId("range-3M").click();
  await expect(app.getByTestId("tf-1D")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await chartWindow(app)).join("-")).toBe("0-60");
});

test("Sell/Buy boxes in the legend prefill the order ticket", async ({ app }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  await app.getByTestId("legend-sell").click();
  await expect(app.getByTestId("ticket-side-sell")).toHaveAttribute("aria-checked", "true");
  await expect(app.getByTestId("ticket-symbol")).toHaveValue(ticker);
  await app.getByTestId("legend-buy").click();
  await expect(app.getByTestId("ticket-side-buy")).toHaveAttribute("aria-checked", "true");
});
