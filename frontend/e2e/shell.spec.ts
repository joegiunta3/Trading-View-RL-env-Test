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

test("session close shows the closed state and disables trading", async ({ app, env }) => {
  await env.advance(27000);
  await waitForClock(app, "16:30:00");
  await expect(app.getByTestId("market-status")).toHaveText("Session closed");
  await expect(app.getByTestId("session-closed")).toBeVisible();
  await expect(app.getByTestId("ticket-review")).toBeDisabled();
  await expect(app.getByTestId("toast-info")).toContainText("Session closed");
});

test("a new episode reloads the page state", async ({ app, env }) => {
  await env.advance(600);
  await waitForClock(app, "09:10:00");
  await env.reset({ start_time: "13:00" });
  await waitForClock(app, "13:00:00");
});
