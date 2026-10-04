import { expect, test, waitForClock } from "./fixtures";

test("shell loads with server-provided name, sim clock and market status", async ({ app, env, request }) => {
  const cfg = await (await request.get("/api/config")).json();
  await expect(app).toHaveTitle(cfg.app_name);
  await expect(app.getByTestId("app-logo")).toHaveText(cfg.app_name);
  await expect(app.getByTestId("market-status")).toHaveText("Market open");
  for (const id of ["toolbar", "chart", "watchlists", "bottom-panel", "order-ticket"]) {
    await expect(app.getByTestId(id)).toBeVisible();
  }
  await env.advance(3600);
  await waitForClock(app, "10:00:00");
});

test("pre-open: clock frozen at start time and trading disabled", async ({ page, env, consoleProblems }) => {
  void consoleProblems;
  await env.reset({ start_time: "12:00" }, false);
  await page.goto("/");
  await expect(page.getByTestId("clock-time")).toHaveText("12:00:00");
  await expect(page.getByTestId("market-status")).toHaveText("Pre-open");
  await expect(page.getByTestId("ticket-review")).toBeDisabled();
});

test("day 1 close, after-hours break, day 2 open, final close", async ({ app, env }) => {
  await expect(app.getByTestId("clock-date")).toHaveText("Day 1 of 2 · 2026-01-15");
  await env.advance(27000); // day 1 16:30 close -> after-hours break
  await waitForClock(app, "16:30:00");
  await expect(app.getByTestId("market-status")).toHaveText("After hours · opens in 0:45");
  await expect(app.getByTestId("chart-overlay")).toContainText("next session opens in 0:45");
  await expect(app.getByTestId("chart-overlay")).toContainText("Jan 16 09:00:00");
  await expect(app.getByTestId("ticket-review")).toBeDisabled();
  await expect(app.getByTestId("toast-info")).toContainText("Day 1 closed");

  await env.advance(270); // the 45-real-second break is 270 sim seconds
  await waitForClock(app, "09:00:00");
  await expect(app.getByTestId("clock-date")).toHaveText("Day 2 of 2 · 2026-01-16");
  await expect(app.getByTestId("market-status")).toHaveText("Market open");
  await expect(app.getByTestId("chart-overlay")).toHaveCount(0);
  await expect(app.getByTestId("ticket-review")).toBeEnabled();
  await expect(app.getByTestId("legend-time")).toHaveText("Jan 16 09:00");

  await env.advance(27000); // day 2 close = end of episode
  await waitForClock(app, "16:30:00");
  await expect(app.getByTestId("market-status")).toHaveText("Session closed");
  await expect(app.getByTestId("chart-overlay")).toContainText("final trading day has ended");
  await expect(app.getByTestId("ticket-review")).toBeDisabled();
});

test("a new episode reloads the page state", async ({ app, env }) => {
  await env.advance(600);
  await waitForClock(app, "09:10:00");
  await env.reset({ start_time: "13:00" });
  await waitForClock(app, "13:00:00");
});
