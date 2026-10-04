import type {
  Account,
  Alert,
  AlertCondition,
  AlertLogEntry,
  AppConfig,
  Bar,
  ChartPrefs,
  Clock,
  Indicator,
  Order,
  OrderType,
  Position,
  Quote,
  Side,
  SymbolInfo,
  Trade,
  Watchlist,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function detailText(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("detail" in data)) return null;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${d?.msg}` : String(d?.msg ?? "Invalid input");
      })
      .join("; ");
  }
  return null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(detailText(data) ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),
  clock: () => request<Clock>("GET", "/api/clock"),
  symbols: () => request<SymbolInfo[]>("GET", "/api/symbols"),
  quotes: () => request<Quote[]>("GET", "/api/quotes"),
  bars: (ticker: string, tf: string) =>
    request<{ ticker: string; timeframe: string; bars: Bar[] }>("GET", `/api/bars/${enc(ticker)}?tf=${enc(tf)}`),

  account: () => request<Account>("GET", "/api/account"),
  positions: () => request<Position[]>("GET", "/api/positions"),
  orders: () => request<Order[]>("GET", "/api/orders"),
  trades: () => request<Trade[]>("GET", "/api/trades"),
  placeOrder: (o: {
    ticker: string;
    side: Side;
    type: OrderType;
    qty: number;
    limit_price?: number | null;
    stop_price?: number | null;
  }) => request<Order>("POST", "/api/orders", o),
  cancelOrder: (id: number) => request<Order>("DELETE", `/api/orders/${id}`),

  watchlists: () => request<Watchlist[]>("GET", "/api/watchlists"),
  createWatchlist: (name: string) => request<Watchlist>("POST", "/api/watchlists", { name }),
  renameWatchlist: (id: number, name: string) => request<Watchlist>("PATCH", `/api/watchlists/${id}`, { name }),
  deleteWatchlist: (id: number) => request<{ ok: boolean }>("DELETE", `/api/watchlists/${id}`),
  addToWatchlist: (id: number, ticker: string) =>
    request<Watchlist>("POST", `/api/watchlists/${id}/items`, { ticker }),
  removeFromWatchlist: (id: number, ticker: string) =>
    request<Watchlist>("DELETE", `/api/watchlists/${id}/items/${enc(ticker)}`),

  alerts: () => request<Alert[]>("GET", "/api/alerts"),
  alertLog: () => request<AlertLogEntry[]>("GET", "/api/alerts/log"),
  createAlert: (a: { ticker: string; condition: AlertCondition; price: number; note: string }) =>
    request<Alert>("POST", "/api/alerts", a),
  updateAlert: (
    id: number,
    changes: Partial<{ condition: AlertCondition; price: number; note: string; enabled: boolean }>,
  ) => request<Alert>("PATCH", `/api/alerts/${id}`, changes),
  deleteAlert: (id: number) => request<{ ok: boolean }>("DELETE", `/api/alerts/${id}`),

  chartPrefs: (ticker: string) => request<ChartPrefs>("GET", `/api/chart_prefs/${enc(ticker)}`),
  saveChartPrefs: (ticker: string, timeframe: string, indicators: Indicator[]) =>
    request<ChartPrefs>("PUT", `/api/chart_prefs/${enc(ticker)}`, { timeframe, indicators }),
  uiState: () => request<{ active_symbol?: string }>("GET", "/api/ui_state"),
  setActiveSymbol: (ticker: string) =>
    request<{ active_symbol: string }>("PUT", "/api/ui_state", { active_symbol: ticker }),
};
