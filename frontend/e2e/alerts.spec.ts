import { expect, test } from "./fixtures";

test("create, disable, edit and delete an alert", async ({ app, request }) => {
  await app.getByTestId("side-tab-alerts").click();
  await app.getByTestId("alert-ticker").fill("JPM");
  await app.getByTestId("alert-condition").selectOption("crossing_up");
  await app.getByTestId("alert-price").fill("999.50");
  await app.getByTestId("alert-note").fill("watch the open");
  await app.getByTestId("alert-save").click();

  const alerts = async () => (await request.get("/api/alerts")).json();
  await expect
    .poll(alerts)
    .toEqual([expect.objectContaining({ ticker: "JPM", condition: "crossing_up", price: 999.5, note: "watch the open", enabled: true })]);
  const [{ id }] = await alerts();
  await expect(app.getByTestId(`alert-row-${id}`)).toContainText("Crossing up");

  await app.getByTestId(`alert-toggle-${id}`).click();
  await expect.poll(async () => (await alerts())[0].enabled).toBe(false);
  await expect(app.getByTestId(`alert-row-${id}`)).toContainText("Disabled");

  await app.getByTestId(`alert-edit-${id}`).click();
  await app.getByTestId("alert-price").fill("1001");
  await app.getByTestId("alert-condition").selectOption("above");
  await app.getByTestId("alert-save").click();
  await expect.poll(alerts).toEqual([expect.objectContaining({ condition: "above", price: 1001 })]);

  await app.getByTestId(`alert-delete-${id}`).click();
  await expect.poll(alerts).toEqual([]);
});

test("validation errors are shown inline", async ({ app }) => {
  await app.getByTestId("side-tab-alerts").click();
  await app.getByTestId("alert-price").fill("12.345");
  await app.getByTestId("alert-save").click();
  await expect(app.getByTestId("alert-error")).toHaveText("Prices can have at most 2 decimal places.");
  await app.getByTestId("alert-ticker").fill("ZZZZ");
  await app.getByTestId("alert-price").fill("10");
  await app.getByTestId("alert-save").click();
  await expect(app.getByTestId("alert-error")).toHaveText('Unknown symbol "ZZZZ".');
});

test("a triggered alert shows a toast and appears in the log with its sim time", async ({ app, env }) => {
  await app.getByTestId("side-tab-alerts").click();
  await app.getByTestId("alert-ticker").fill("KO");
  await app.getByTestId("alert-condition").selectOption("above");
  await app.getByTestId("alert-price").fill("1.00");
  await app.getByTestId("alert-save").click();
  await expect(app.getByTestId("alert-list")).toContainText("KO");
  await env.advance(30);
  await expect(app.getByTestId("toast-alert")).toContainText("Alert: KO Above 1.00");
  await expect(app.getByTestId("alert-log")).toContainText("Jan 15 09:00:01");
  await expect(app.getByTestId("alert-list")).toContainText("Triggered Jan 15 09:00:01");
});

test("toolbar Alert button opens the form prefilled with the active symbol and price", async ({ app, request }) => {
  const ticker = (await app.getByTestId("legend-ticker").textContent())!;
  await app.getByTestId("toolbar-alert").click();
  const q = await (await request.get(`/api/quotes/${ticker}`)).json();
  await expect(app.getByTestId("alert-ticker")).toHaveValue(ticker);
  await expect(app.getByTestId("alert-price")).toHaveValue(q.last.toFixed(2));
});
