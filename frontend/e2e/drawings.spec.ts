import { type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { chartWindow, type Env, expect, test } from "./fixtures";

type Bar = { time: number; o: number; h: number; l: number; c: number };
type Drawing = {
  id: number;
  ticker: string;
  kind: string;
  points: { time: number; price: number; label: string }[];
  stats: { price_change: number; pct_change: number; change_cents: number } | null;
};

const GRID_LEFT = 10;
const GRID_RIGHT = 72;

const drawingsApi = async (request: APIRequestContext): Promise<Drawing[]> =>
  (await request.get("/api/drawings")).json();
const barsApi = async (request: APIRequestContext, t: string, tf: string): Promise<Bar[]> =>
  (await (await request.get(`/api/bars/${t}?tf=${tf}`)).json()).bars;

/** Screen position of bar `i` in a pane (y as a fraction of the canvas height). */
async function barPoint(scope: Locator | Page, i: number, yFrac: number) {
  const canvas = scope.getByTestId("chart-canvas");
  const box = (await canvas.boundingBox())!;
  const w = await canvas.getAttribute("data-window");
  const [start, end] = w!.split("-").map(Number);
  const band = (box.width - GRID_LEFT - GRID_RIGHT) / (end - start + 1);
  return { x: box.x + GRID_LEFT + (i - start + 0.5) * band, y: box.y + box.height * yFrac };
}

async function clickBar(page: Page, scope: Locator | Page, i: number, yFrac: number) {
  const p = await barPoint(scope, i, yFrac);
  await page.mouse.click(p.x, p.y);
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fresh episode at 11:00 with pane 0 showing AAPL on 1h; waits until the chart has data. */
async function setup(app: Page, env: Env) {
  await env.reset({ setup: { panes: [{ pane: 0, ticker: "AAPL", timeframe: "1h" }] } });
  await env.advance(7200);
  await app.reload();
  await expect(app.getByTestId("legend-timeframe")).toHaveText("1h");
  await expect(app.getByTestId("chart-canvas")).toHaveAttribute("data-bars", /\d+/);
}

test("info line snaps to bar prices with the magnet and its label matches the stored numbers", async ({ app, env, request }) => {
  await setup(app, env);
  const bars = await barsApi(request, "AAPL", "1h");
  const n = bars.length;
  await app.getByTestId("tool-magnet").click();
  await expect(app.getByTestId("tool-magnet")).toHaveAttribute("aria-pressed", "true");
  await app.getByTestId("tool-lines-menu").click();
  await app.getByTestId("tool-line-info_line").click();
  await expect(app.getByTestId("drawing-capture")).toBeVisible();
  await clickBar(app, app, n - 40, 0.7);
  await clickBar(app, app, n - 12, 0.3);

  await expect.poll(async () => (await drawingsApi(request)).length).toBe(1);
  const [d] = await drawingsApi(request);
  expect(d.kind).toBe("info_line");
  for (const [k, idx] of [
    [0, n - 40],
    [1, n - 12],
  ] as const) {
    const bar = bars[idx];
    expect(d.points[k].time).toBe(bar.time);
    expect([bar.o, bar.h, bar.l, bar.c]).toContain(d.points[k].price);
  }
  const cents = Math.round(d.points[1].price * 100) - Math.round(d.points[0].price * 100);
  expect(d.stats!.change_cents).toBe(cents);
  const label = app.getByTestId(`drawing-info-${d.id}`);
  await expect(label).toContainText(`(${d.stats!.pct_change > 0 ? "+" : ""}${d.stats!.pct_change.toFixed(2)}%)`);
  await expect(label).toContainText("28 bars (28h)");
  await expect(label).toContainText(money(Math.abs(d.stats!.price_change)));
  await expect(app.getByTestId("drawing-capture")).toHaveCount(0); // tool is done after placing
});

test("trend, horizontal and vertical lines; keyboard shortcuts; Esc cancels", async ({ app, env, request }) => {
  await setup(app, env);
  const n = (await barsApi(request, "AAPL", "1h")).length;

  await app.keyboard.press("Alt+KeyT");
  await clickBar(app, app, n - 30, 0.5);
  await app.keyboard.press("Escape"); // cancel half-drawn trendline
  await expect(app.getByTestId("drawing-capture")).toHaveCount(0);
  expect(await drawingsApi(request)).toEqual([]);

  await app.keyboard.press("Alt+KeyT");
  await clickBar(app, app, n - 30, 0.5);
  await clickBar(app, app, n - 10, 0.4);
  await app.keyboard.press("Alt+KeyH");
  await clickBar(app, app, n - 20, 0.25);
  await app.getByTestId("tool-lines-menu").click();
  await app.getByTestId("tool-line-vertical_line").click();
  await clickBar(app, app, n - 5, 0.5);

  await expect.poll(async () => (await drawingsApi(request)).map((d) => d.kind)).toEqual([
    "trendline",
    "horizontal_line",
    "vertical_line",
  ]);
  for (const d of await drawingsApi(request)) await expect(app.getByTestId(`drawing-${d.id}`)).toHaveCount(1);
});

test("select, drag a handle, then delete with the Delete key", async ({ app, env, request }) => {
  await setup(app, env);
  const bars = await barsApi(request, "AAPL", "1h");
  const n = bars.length;
  await app.keyboard.press("Alt+KeyT");
  await clickBar(app, app, n - 30, 0.6);
  await clickBar(app, app, n - 10, 0.4);
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(1);
  const [d] = await drawingsApi(request);
  await expect(app.getByTestId(`drawing-handle-${d.id}-1`)).toBeVisible(); // new drawings are selected

  const handle = (await app.getByTestId(`drawing-handle-${d.id}-1`).boundingBox())!;
  const target = await barPoint(app, n - 4, 0.2);
  await app.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await app.mouse.down();
  await app.mouse.move(target.x, target.y, { steps: 5 });
  await app.mouse.up();
  await expect.poll(async () => (await drawingsApi(request))[0].points[1].time).toBe(bars[n - 4].time);
  expect((await drawingsApi(request))[0].points[0]).toEqual(d.points[0]);

  await app.keyboard.press("Delete");
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(0);
  await expect(app.getByTestId(`drawing-${d.id}`)).toHaveCount(0);
});

test("drawings belong to the symbol and survive timeframe changes", async ({ app, env, request }) => {
  await setup(app, env);
  const n = (await barsApi(request, "AAPL", "1h")).length;
  await app.keyboard.press("Alt+KeyH");
  await clickBar(app, app, n - 20, 0.3);
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(1);
  const [d] = await drawingsApi(request);

  await app.getByTestId("tf-15m").click();
  await expect(app.getByTestId(`drawing-${d.id}`)).toHaveCount(1);

  await app.getByTestId("layout-button").click();
  await app.getByTestId("layout-option-2").click();
  const pane1 = app.getByTestId("pane-1");
  await pane1.click({ position: { x: 200, y: 200 } });
  await app.getByTestId("symbol-search").fill("AAPL");
  await app.getByTestId("symbol-search").press("Enter");
  await expect(pane1.getByTestId(`drawing-${d.id}`)).toHaveCount(1); // same symbol, other pane
  await app.getByTestId("symbol-search").fill("XOM");
  await app.getByTestId("symbol-search").press("Enter");
  await expect(pane1.getByTestId(`drawing-${d.id}`)).toHaveCount(0); // other symbol: hidden
  await expect(app.getByTestId("pane-0").getByTestId(`drawing-${d.id}`)).toHaveCount(1);
});

test("drawings list shows each drawing as text; remove all clears the symbol", async ({ app, env, request }) => {
  await setup(app, env);
  const n = (await barsApi(request, "AAPL", "1h")).length;
  await app.getByTestId("tool-magnet").click();
  await app.keyboard.press("Alt+KeyI");
  await clickBar(app, app, n - 25, 0.7);
  await clickBar(app, app, n - 5, 0.3);
  await app.keyboard.press("Alt+KeyH");
  await clickBar(app, app, n - 15, 0.5);
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(2);
  const [info, horiz] = await drawingsApi(request);

  await app.getByTestId("side-tab-drawings").click();
  await expect(app.getByTestId("side-tab-drawings")).toHaveText("Drawings (2)");
  await expect(app.getByTestId(`drawing-row-${info.id}-point-0`)).toHaveText(
    `${info.points[0].label} · ${money(info.points[0].price)}`,
  );
  await expect(app.getByTestId(`drawing-row-${info.id}-stats`)).toContainText(`${info.stats!.pct_change.toFixed(2)}%`);
  await expect(app.getByTestId(`drawing-row-${horiz.id}-point-0`)).toHaveText(money(horiz.points[0].price));

  await app.getByTestId(`drawing-row-${horiz.id}`).click();
  await expect(app.getByTestId(`drawing-row-${horiz.id}`)).toHaveAttribute("aria-selected", "true");
  await app.getByTestId("tool-remove-drawings").click();
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(0);
  await expect(app.getByTestId("drawings-list")).toHaveCount(0);
});

test("can draw into the empty space right of the last bar", async ({ app, env, request }) => {
  await setup(app, env);
  const bars = await barsApi(request, "AAPL", "1h");
  const n = bars.length;
  const [, end] = await chartWindow(app);
  expect(end).toBe(n - 1 + 8);
  await app.keyboard.press("Alt+KeyT");
  await clickBar(app, app, n - 10, 0.5);
  await clickBar(app, app, n + 5, 0.4); // 6 bars into the future
  await expect.poll(async () => (await drawingsApi(request)).length).toBe(1);
  const [d] = await drawingsApi(request);
  expect(d.points[1].time).toBe(bars[n - 1].time + 6 * 3600);
});
