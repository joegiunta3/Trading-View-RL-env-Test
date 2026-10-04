import { expect, test } from "./fixtures";

type Q = { ticker: string; sector: string; last: number; change_pct: number; volume: number };

test("filters by sector and sorts by column", async ({ app, env, request }) => {
  await env.advance(3600);
  await expect(app.getByTestId("clock-time")).toHaveText("10:00:00");
  await app.getByTestId("side-tab-screener").click();
  await expect(app.getByTestId("screener-count")).toHaveText("20 of 20 symbols");

  await app.getByTestId("screener-sector").selectOption("Energy");
  const quotes: Q[] = await (await request.get("/api/quotes")).json();
  const energy = quotes.filter((q) => q.sector === "Energy");
  await expect(app.getByTestId("screener-count")).toHaveText("4 of 20 symbols");

  await app.getByTestId("screener-sort-change_pct").click(); // numeric columns sort descending first
  const order = [...energy].sort((a, b) => b.change_pct - a.change_pct).map((q) => q.ticker);
  await expect(app.locator('[data-testid^="screener-row-"]')).toHaveText(order.map((t) => new RegExp(`^${t}`)));
  await expect(app.getByTestId("screener-table").locator("th[aria-sort=descending]")).toContainText("Chg%");

  await app.getByTestId(`screener-row-${order[0]}`).click();
  await expect(app.getByTestId("legend-ticker")).toHaveText(order[0]);

  await app.getByTestId("screener-sector").selectOption("");
  const minPrice = 200;
  await app.getByTestId("screener-min-price").fill(String(minPrice));
  const n = quotes.filter((q) => q.last >= minPrice).length;
  await expect(app.getByTestId("screener-count")).toHaveText(`${n} of 20 symbols`);

});

test("screener values are live", async ({ app, env, request }) => {
  await app.getByTestId("side-tab-screener").click();
  await env.advance(1800);
  await expect(app.getByTestId("clock-time")).toHaveText("09:30:00");
  const q: Q = (await (await request.get("/api/quotes/AAPL")).json()) as Q;
  await expect(app.getByTestId("screener-row-AAPL")).toContainText(q.volume.toLocaleString("en-US"));
});
