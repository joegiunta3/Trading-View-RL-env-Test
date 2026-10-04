import { expect, test } from "./fixtures";

async function ticket(
  page: import("@playwright/test").Page,
  o: { side: string; ticker: string; qty: number; type?: string; limit?: string; stop?: string },
) {
  await page.getByTestId(`ticket-side-${o.side}`).click();
  await page.getByTestId("ticket-symbol").fill(o.ticker);
  await page.getByTestId("ticket-qty").fill(String(o.qty));
  await page.getByTestId("ticket-type").selectOption(o.type ?? "market");
  if (o.limit) await page.getByTestId("ticket-limit").fill(o.limit);
  if (o.stop) await page.getByTestId("ticket-stop").fill(o.stop);
  await page.getByTestId("ticket-review").click();
  await expect(page.getByTestId("ticket-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-symbol")).toHaveText(o.ticker);
  await expect(page.getByTestId("confirm-qty")).toHaveText(String(o.qty));
  await page.getByTestId("ticket-submit").click();
}

test("market buy goes through the confirmation step and fills", async ({ app, request }) => {
  await ticket(app, { side: "buy", ticker: "AAPL", qty: 10 });
  await expect(app.getByTestId("ticket-result")).toHaveAttribute("data-status", "filled");
  await expect(app.getByTestId("toast-success")).toContainText("Filled: BUY 10 AAPL");
  await expect(app.getByTestId("position-qty-AAPL")).toHaveText("10");
  const [pos] = await (await request.get("/api/positions")).json();
  expect(pos).toMatchObject({ ticker: "AAPL", qty: 10 });
  await app.getByTestId("bottom-tab-history").click();
  await expect(app.getByTestId("history-table")).toContainText("AAPL");
  await app.getByTestId("bottom-tab-pnl").click();
  await expect(app.getByTestId("pnl-summary")).toBeVisible();
});

test("back from confirmation does not send an order", async ({ app, request }) => {
  await app.getByTestId("ticket-qty").fill("5");
  await app.getByTestId("ticket-review").click();
  await app.getByTestId("ticket-back").click();
  await expect(app.getByTestId("ticket-review")).toBeVisible();
  expect(await (await request.get("/api/orders")).json()).toEqual([]);
});

test("limit order works, shows in Orders and can be cancelled", async ({ app, request }) => {
  await ticket(app, { side: "buy", ticker: "MSFT", qty: 3, type: "limit", limit: "1.00" });
  await expect(app.getByTestId("ticket-result")).toHaveAttribute("data-status", "working");
  await app.getByTestId("bottom-tab-orders").click();
  const [order] = await (await request.get("/api/orders")).json();
  await expect(app.getByTestId(`order-status-${order.id}`)).toHaveText("working");
  await app.getByTestId(`order-cancel-${order.id}`).click();
  await expect(app.getByTestId(`order-status-${order.id}`)).toHaveText("cancelled");
});

test("rejections are explained", async ({ app }) => {
  await ticket(app, { side: "sell", ticker: "NVDA", qty: 5 });
  await expect(app.getByTestId("ticket-result")).toHaveAttribute("data-status", "rejected");
  await expect(app.getByTestId("ticket-result")).toContainText("only 0 shares available to sell");
  await expect(app.getByTestId("toast-error")).toBeVisible();

  await app.getByTestId("ticket-qty").fill("1.5");
  await app.getByTestId("ticket-review").click();
  await expect(app.getByTestId("ticket-error")).toHaveText("Quantity must be a positive whole number.");
});

test("short, then close from Positions prefills a cover", async ({ app, request }) => {
  await ticket(app, { side: "short", ticker: "PFE", qty: 7 });
  await expect(app.getByTestId("position-qty-PFE")).toHaveText("-7");
  await app.getByTestId("position-close-PFE").click();
  await expect(app.getByTestId("ticket-side-cover")).toHaveAttribute("aria-checked", "true");
  await expect(app.getByTestId("ticket-qty")).toHaveValue("7");
  await expect(app.getByTestId("ticket-symbol")).toHaveValue("PFE");
  await app.getByTestId("ticket-review").click();
  await app.getByTestId("ticket-submit").click();
  await expect(app.getByTestId("position-row-PFE")).toHaveCount(0);
  expect(await (await request.get("/api/positions")).json()).toEqual([]);
});

test("stop order triggers as the clock advances", async ({ app, env, request }) => {
  await env.reset({ setup: { positions: [{ ticker: "AAPL", qty: 10, avg_price: 130 }] } });
  await app.reload();
  const last = (await (await request.get("/api/quotes/AAPL")).json()).last as number;
  const stop = (Math.floor(last * 100) / 100 - 0.01).toFixed(2);
  await ticket(app, { side: "sell", ticker: "AAPL", qty: 10, type: "stop", stop });
  await expect(app.getByTestId("ticket-result")).toHaveAttribute("data-status", "working");
  await env.advance(27000);
  const [order] = await (await request.get("/api/orders")).json();
  expect(["filled", "cancelled"]).toContain(order.status);
  await app.getByTestId("bottom-tab-orders").click();
  await expect(app.getByTestId(`order-status-${order.id}`)).toContainText(order.status);
});
