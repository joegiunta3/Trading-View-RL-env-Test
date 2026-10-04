import { expect, FORBIDDEN, test } from "./fixtures";

/** Nothing about planted scenarios, the env API or the future may reach the browser. */
test("API responses, WebSocket frames, HTML and bundles contain no hidden data", async ({ page, env, consoleProblems }) => {
  void consoleProblems;
  const bodies: string[] = [];
  const hosts = new Set<string>();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("response", async (r) => {
    try {
      bodies.push(await r.text());
    } catch {
      /* redirects and aborted requests have no body */
    }
  });
  page.on("websocket", (ws) => ws.on("framereceived", (f) => bodies.push(String(f.payload))));

  await env.reset({ start_time: "10:30" });
  await page.goto("/");
  await expect(page.getByTestId("legend-c")).toBeVisible();
  for (const tf of ["1m", "5m", "15m", "1h", "1D"]) await page.getByTestId(`tf-${tf}`).click();
  await page.getByTestId("side-tab-screener").click();
  await page.getByTestId("side-tab-alerts").click();
  for (const tab of ["orders", "history", "pnl", "positions"]) await page.getByTestId(`bottom-tab-${tab}`).click();
  await env.advance(1800);
  await expect(page.getByTestId("clock-time")).toHaveText("11:00:00");

  const html = await page.content();
  const blob = [html, ...bodies].join("\n");
  for (const re of FORBIDDEN) expect(blob, `found ${re}`).not.toMatch(re);
  expect([...hosts]).toEqual([new URL(page.url()).host]);

  // The newest bar anywhere on the page is the current sim minute; nothing later.
  await page.getByTestId("tf-1m").click();
  await expect(page.getByTestId("legend-time")).toHaveText("Jan 15 11:00");
});
