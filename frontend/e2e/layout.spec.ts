import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const layoutApi = async (request: import("@playwright/test").APIRequestContext) =>
  (await request.get("/api/layout")).json();

async function chooseLayout(page: Page, id: string) {
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("layout-menu")).toBeVisible();
  await page.getByTestId(`layout-option-${id}`).click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-layout", id);
}

const pane = (page: Page, i: number) => page.getByTestId(`pane-${i}`);

test("layout picker offers exactly 1, 2, 3 and 4 charts", async ({ app }) => {
  await app.getByTestId("layout-button").click();
  await expect(app.getByTestId("layout-menu").getByRole("menuitemradio")).toHaveCount(4);
  await expect(app.getByTestId("layout-option-1")).toHaveAttribute("aria-checked", "true");
});

test("switching layouts shows the right number of panes and persists", async ({ app, request }) => {
  for (const [id, n] of [["2", 2], ["3", 3], ["4", 4], ["1", 1]] as const) {
    await chooseLayout(app, id);
    await expect(app.locator('[data-testid^="pane-"][data-active]')).toHaveCount(n);
    for (let i = 0; i < n; i++) await expect(pane(app, i).getByTestId("legend-c")).toBeVisible();
    await expect.poll(async () => (await layoutApi(request)).layout).toBe(id);
  }
  await chooseLayout(app, "4");
  await app.reload();
  await expect(app.getByTestId("chart-grid")).toHaveAttribute("data-layout", "4");
});

test("each pane holds its own symbol, timeframe and indicators", async ({ app, request }) => {
  await chooseLayout(app, "4");
  const plan = [
    { ticker: "AAPL", tf: "1m" },
    { ticker: "XOM", tf: "15m" },
    { ticker: "GS", tf: "1h" },
    { ticker: "KO", tf: "1D" },
  ];
  for (const [i, p] of plan.entries()) {
    await pane(app, i).click({ position: { x: 200, y: 160 } });
    await expect(pane(app, i)).toHaveAttribute("data-active", "true");
    await app.getByTestId("symbol-search").fill(p.ticker);
    await app.getByTestId("symbol-search").press("Enter");
    await app.getByTestId(`tf-${p.tf}`).click();
    await expect(pane(app, i).getByTestId("legend-ticker")).toHaveText(p.ticker);
    await expect(pane(app, i).getByTestId("legend-timeframe")).toHaveText(p.tf);
  }
  await pane(app, 2).click({ position: { x: 200, y: 160 } });
  await app.getByTestId("indicators-button").click();
  await app.getByTestId("add-sma").click();
  await app.getByTestId("indicators-button").click();
  await pane(app, 2).getByTestId("study-sma-20").click();
  await pane(app, 2).getByTestId("study-settings-sma-20").click();
  await pane(app, 2).getByTestId("settings-period").fill("50");
  await pane(app, 2).getByTestId("settings-apply").click();
  await expect(pane(app, 2).getByTestId("legend-sma-50")).toBeVisible();
  await expect(pane(app, 0).getByTestId("legend-sma-50")).toHaveCount(0);

  await expect
    .poll(async () => (await layoutApi(request)).panes.map((p: { ticker: string; timeframe: string }) => `${p.ticker}|${p.timeframe}`))
    .toEqual(plan.map((p) => `${p.ticker}|${p.tf}`));
  const state = await layoutApi(request);
  expect(state.active_pane).toBe(2);
  expect(state.panes[2].indicators).toContainEqual({ type: "sma", period: 50 });
});

test("watchlist, order ticket and details follow the active pane", async ({ app, request }) => {
  await chooseLayout(app, "2");
  await pane(app, 1).click({ position: { x: 200, y: 160 } });
  const [first] = await (await request.get("/api/watchlists")).json();
  const t = first.tickers[3];
  await app.getByTestId(`watch-row-${t}`).click();
  await expect(pane(app, 1).getByTestId("legend-ticker")).toHaveText(t);
  await expect(app.getByTestId("ticket-symbol")).toHaveValue(t);
  await expect(app.getByTestId("symbol-ticker")).toHaveText(t);
  const other = (await layoutApi(request)).panes[0].ticker;
  await expect(pane(app, 0).getByTestId("legend-ticker")).toHaveText(other);
});

test("shrinking hides panes but keeps their settings", async ({ app, request }) => {
  await chooseLayout(app, "4");
  await pane(app, 3).click({ position: { x: 200, y: 160 } });
  await app.getByTestId("symbol-search").fill("NVDA");
  await app.getByTestId("symbol-search").press("Enter");
  await expect(pane(app, 3).getByTestId("legend-ticker")).toHaveText("NVDA");
  await chooseLayout(app, "2");
  await expect(pane(app, 3)).toHaveCount(0);
  await expect.poll(async () => (await layoutApi(request)).active_pane).toBe(0);
  await chooseLayout(app, "4");
  await expect(pane(app, 3).getByTestId("legend-ticker")).toHaveText("NVDA");
});

test("maximize a pane and restore the layout", async ({ app }) => {
  await chooseLayout(app, "3");
  await app.getByTestId("pane-maximize-1").click();
  await expect(pane(app, 0)).toBeHidden();
  await expect(pane(app, 2)).toBeHidden();
  await expect(pane(app, 1)).toBeVisible();
  await app.getByTestId("pane-maximize-1").click();
  for (const i of [0, 1, 2]) await expect(pane(app, i)).toBeVisible();
});

test("every pane updates live and zooms independently", async ({ app, env }) => {
  await chooseLayout(app, "4");
  await env.advance(600);
  await expect(app.getByTestId("clock-time")).toHaveText("09:10:00");
  for (let i = 0; i < 4; i++) await expect(pane(app, i).getByTestId("legend-time")).toHaveText("Jan 15 09:10");
  const before = await pane(app, 1).getByTestId("chart-canvas").getAttribute("data-window");
  const other = await pane(app, 2).getByTestId("chart-canvas").getAttribute("data-window");
  await pane(app, 1).getByTestId("chart-zoom-in").click();
  await expect(pane(app, 1).getByTestId("chart-canvas")).not.toHaveAttribute("data-window", before!);
  await expect(pane(app, 2).getByTestId("chart-canvas")).toHaveAttribute("data-window", other!);
});
