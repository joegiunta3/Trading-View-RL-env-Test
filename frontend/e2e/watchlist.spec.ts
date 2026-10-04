import { expect, test } from "./fixtures";

test("create, fill, rename, edit and delete a watchlist", async ({ app, request }) => {
  await app.getByTestId("watchlist-menu").click();
  await app.getByTestId("watchlist-new").click();
  await app.getByTestId("watchlist-name-input").fill("Tech Picks");
  await app.getByTestId("watchlist-name-save").click();
  await expect(app.getByTestId("watchlist-select").locator("option:checked")).toHaveText("Tech Picks");

  await app.getByTestId("watchlist-add-toggle").click();
  for (const t of ["AAPL", "msft", "NVDA"]) {
    await app.getByTestId("watchlist-add-input").fill(t);
    await app.getByTestId("watchlist-add").click();
  }
  for (const t of ["AAPL", "MSFT", "NVDA"]) await expect(app.getByTestId(`watch-row-${t}`)).toBeVisible();

  const lists = async () => (await request.get("/api/watchlists")).json();
  await expect.poll(lists).toContainEqual(expect.objectContaining({ name: "Tech Picks", tickers: ["AAPL", "MSFT", "NVDA"] }));

  await app.getByTestId("watchlist-add-input").fill("AAPL");
  await app.getByTestId("watchlist-add").click();
  await expect(app.getByTestId("watchlist-error")).toHaveText("AAPL is already in Tech Picks.");

  await app.getByTestId("watch-row-MSFT").hover();
  await app.getByTestId("watch-remove-MSFT").click();
  await expect(app.getByTestId("watch-row-MSFT")).toHaveCount(0);

  await app.getByTestId("watchlist-menu").click();
  await app.getByTestId("watchlist-rename").click();
  await app.getByTestId("watchlist-name-input").fill("Watchlist");
  await app.getByTestId("watchlist-name-save").click();
  await expect(app.getByTestId("watchlist-error")).toContainText("already exists");
  await expect(app.getByTestId("watchlist-name-input")).toBeVisible(); // stays open to fix the name
  await app.getByTestId("watchlist-name-input").fill("Megacaps");
  await app.getByTestId("watchlist-name-save").click();
  await expect.poll(lists).toContainEqual(expect.objectContaining({ name: "Megacaps", tickers: ["AAPL", "NVDA"] }));

  await app.getByTestId("watch-row-NVDA").click();
  await expect(app.getByTestId("legend-ticker")).toHaveText("NVDA");

  await app.getByTestId("watchlist-menu").click();
  await app.getByTestId("watchlist-delete").click();
  await app.getByTestId("watchlist-delete-confirm").click();
  await expect.poll(async () => (await lists()).map((l: { name: string }) => l.name)).toEqual(["Watchlist"]);
});

test("watchlist rows show live quotes", async ({ app, request }) => {
  const quotes: { ticker: string; last: number }[] = await (await request.get("/api/quotes")).json();
  const [first] = await (await request.get("/api/watchlists")).json();
  const t = first.tickers[0];
  const q = quotes.find((x) => x.ticker === t)!;
  await expect(app.getByTestId(`watch-row-${t}`)).toContainText(q.last.toFixed(2));
});

test("symbol details panel follows the active symbol", async ({ app, request }) => {
  const [first] = await (await request.get("/api/watchlists")).json();
  const t = first.tickers[1];
  await app.getByTestId(`watch-row-${t}`).click();
  await expect(app.getByTestId("symbol-ticker")).toHaveText(t);
  const q = await (await request.get(`/api/quotes/${t}`)).json();
  await expect(app.getByTestId("symbol-last")).toHaveText(q.last.toFixed(2));
});
