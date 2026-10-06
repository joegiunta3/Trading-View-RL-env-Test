import { type APIRequestContext, type Page } from "@playwright/test";
import { type Env, expect, test } from "./fixtures";

type Trade = { number: number; side: string; open: boolean; entry_price: number; exit_price?: number; pnl: number };
type Bt = { trades: Trade[]; stats: Record<string, number | null>; range: { to: string }; bars_tested: number };

const backtest = async (request: APIRequestContext, pane = 0): Promise<Bt> =>
  (await request.get(`/api/panes/${pane}/backtest`)).json();
const layout = async (request: APIRequestContext) => (await request.get("/api/layout")).json();
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${money(Math.abs(n))}`;

/** Episode at 11:30 with AAPL on 15m (plenty of crossovers in the history). */
async function setup(app: Page, env: Env) {
  await env.reset({ setup: { panes: [{ pane: 0, ticker: "AAPL", timeframe: "15m" }] } });
  await env.advance(9000);
  await app.reload();
  await expect(app.getByTestId("legend-timeframe")).toHaveText("15m");
}

async function addStrategy(app: Page, type: string) {
  await app.getByTestId("indicators-button").click();
  await app.getByTestId(`add-strategy-${type}`).click();
  await app.getByTestId("indicators-button").click();
}

test("strategies have their own section in the Indicators menu; adding one opens the tester", async ({
  app,
  env,
  request,
}) => {
  await setup(app, env);
  await app.getByTestId("indicators-button").click();
  await expect(app.getByTestId("indicators-menu")).toContainText("Strategies");
  await expect(app.getByTestId("add-strategy-ma_cross")).toContainText("MA Crossover");
  await expect(app.getByTestId("add-strategy-rsi_reversal")).toContainText("RSI Reversal");
  await app.getByTestId("add-strategy-ma_cross").click();
  await expect(app.getByTestId("toast-success")).toContainText("Strategy added to chart");
  await app.getByTestId("indicators-button").click();

  await expect(app.getByTestId("strategy-name")).toHaveText("MA Crossover 9 21");
  await expect(app.getByTestId("bottom-tab-strategy")).toHaveAttribute("aria-selected", "true");
  expect((await layout(request)).panes[0].strategy).toEqual({
    type: "ma_cross",
    fast: 9,
    slow: 21,
    qty: 100,
    direction: "both",
  });

  const bt = await backtest(request);
  expect(bt.trades.length).toBeGreaterThan(5);
  await expect(app.getByTestId("stat-total-pnl")).toContainText(signedUsd(bt.stats.total_pnl as number));
  await expect(app.getByTestId("stat-profitable")).toContainText(`${bt.stats.winning_trades}/${bt.stats.total_trades}`);
  await expect(app.getByTestId("strategy-pnl")).toHaveText(`${(bt.stats.total_pnl as number) > 0 ? "+" : ""}${money(bt.stats.total_pnl as number)}`);
  await expect(app.getByTestId("tester-range")).toContainText(bt.range.to);
  await expect(app.getByTestId("chart-canvas")).toHaveAttribute("data-markers", /^[1-9]\d*$/);

  await app.getByTestId("tester-view-trades").click();
  const last = bt.trades.at(-1)!;
  await expect(app.getByTestId(`trade-${last.number}-side`)).toHaveText(last.side === "long" ? "Long" : "Short");
  await expect(app.getByTestId(`trade-${last.number}-entry-price`)).toHaveText(money(last.entry_price));
  await expect(app.getByTestId(`trade-${last.number}-pnl`)).toHaveText(signedUsd(last.pnl));
  const first = bt.trades[0];
  await expect(app.getByTestId(`trade-${first.number}-exit-price`)).toHaveText(money(first.exit_price!));
});

test("edit settings (with validation), hide/show and remove the strategy from its chart row", async ({
  app,
  env,
  request,
}) => {
  await setup(app, env);
  await addStrategy(app, "ma_cross");
  const row = app.getByTestId("strategy-row");
  await row.click();
  await app.getByTestId("strategy-settings").click();
  await app.getByTestId("settings-fast").fill("30");
  await app.getByTestId("settings-apply").click();
  await expect(app.getByTestId("settings-error")).toHaveText("Fast length must be shorter than slow length.");
  await app.getByTestId("settings-fast").fill("5");
  await app.getByTestId("settings-slow").fill("20");
  await app.getByTestId("settings-direction").selectOption("long");
  await app.getByTestId("settings-apply").click();
  await expect(app.getByTestId("strategy-name")).toHaveText("MA Crossover 5 20");
  await expect.poll(async () => (await layout(request)).panes[0].strategy).toEqual({
    type: "ma_cross",
    fast: 5,
    slow: 20,
    qty: 100,
    direction: "long",
  });
  const bt = await backtest(request);
  expect(bt.trades.every((t) => t.side === "long")).toBe(true);
  await app.getByTestId("tester-view-trades").click();
  await expect(app.getByTestId(`trade-${bt.trades.at(-1)!.number}-side`)).toHaveText("Long");

  await row.click();
  await app.getByTestId("strategy-hide").click();
  await expect(row).toHaveAttribute("data-hidden", "true");
  await expect(app.getByTestId("chart-canvas")).toHaveAttribute("data-markers", "0");
  await row.click();
  await app.getByTestId("strategy-hide").click();
  await expect(app.getByTestId("chart-canvas")).not.toHaveAttribute("data-markers", "0");

  await row.click();
  await app.getByTestId("strategy-remove").click();
  await expect(app.getByTestId("strategy-row")).toHaveCount(0);
  await expect(app.getByTestId("bottom-panel")).toContainText("No strategy on this chart");
  await expect.poll(async () => (await layout(request)).panes[0].strategy).toBeNull();
});

test("one strategy per chart: adding another replaces it; the tester can expand", async ({ app, env, request }) => {
  await setup(app, env);
  await addStrategy(app, "ma_cross");
  await addStrategy(app, "rsi_reversal");
  await expect(app.getByTestId("toast-success").last()).toContainText("Replaced MA Crossover 9 21");
  await expect(app.getByTestId("strategy-name")).toHaveText("RSI Reversal 14 30 70");
  await expect.poll(async () => (await layout(request)).panes[0].strategy.type).toBe("rsi_reversal");

  await expect(app.getByTestId("bottom-panel")).toHaveAttribute("data-expanded", "false");
  await app.getByTestId("tester-expand").click();
  await expect(app.getByTestId("bottom-panel")).toHaveAttribute("data-expanded", "true");
  await app.getByTestId("tester-expand").click();
  await expect(app.getByTestId("bottom-panel")).toHaveAttribute("data-expanded", "false");
});

test("the backtest updates live as new bars close", async ({ app, env, request }) => {
  await setup(app, env);
  await addStrategy(app, "ma_cross");
  const before = await backtest(request);
  await env.advance(3600); // four more 15m bars close
  await expect(app.getByTestId("clock-time")).toHaveText("12:30:00");
  await expect.poll(async () => (await backtest(request)).bars_tested).toBe(before.bars_tested + 4);
  const after = await backtest(request);
  await expect(app.getByTestId("tester-range")).toContainText(after.range.to);
  await expect(app.getByTestId("stat-total-pnl")).toContainText(signedUsd(after.stats.total_pnl as number));
});
