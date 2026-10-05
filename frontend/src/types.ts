export type AppConfig = {
  app_name: string;
  session_date: string;
  timeframes: string[];
  sectors: string[];
};

export type MarketStatus = "pre-open" | "open" | "after-hours" | "closed";

/** Server clock. `sim_now` is episode seconds; `time` is HH:MM:SS within `day` (1 or 2). */
export type Clock = {
  sim_now: number;
  day: number;
  days: number;
  time: string;
  date: string;
  market_status: MarketStatus;
  session_open: string;
  session_close: string;
  /** Only during the after-hours break. */
  next_open?: string;
  next_open_in?: number;
};

export type SymbolInfo = { ticker: string; name: string; sector: string };

export type Quote = SymbolInfo & {
  last: number;
  bid: number;
  ask: number;
  prev_close: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  range_pct: number;
};

/** `date` is the session date (YYYY-MM-DD); `label` is the bar's open time (HH:MM) or its date for 1D. */
export type Bar = { time: number; date: string; label: string; o: number; h: number; l: number; c: number; v: number };

export type Indicator =
  | { type: "volume" }
  | { type: "sma"; period: number }
  | { type: "ema"; period: number }
  | { type: "bb"; period: number; stddev: number }
  | { type: "vwap" }
  | { type: "rsi"; period: number }
  | { type: "macd"; fast: number; slow: number; signal: number }
  | { type: "kdj"; period: number; k: number; d: number };

export type IndicatorType = Indicator["type"];

export type LayoutId = "1" | "2" | "3" | "4";

/** One chart pane. All four always exist server-side; the layout decides how many are shown. */
export type Pane = { pane: number; ticker: string; timeframe: string; indicators: Indicator[] };

export type Layout = { layout: LayoutId; active_pane: number; panes: Pane[] };

export type Side = "buy" | "sell" | "short" | "cover";
export type OrderType = "market" | "limit" | "stop";

export type Order = {
  id: number;
  ticker: string;
  side: Side;
  type: OrderType;
  qty: number;
  limit_price: number | null;
  stop_price: number | null;
  status: "working" | "filled" | "cancelled" | "rejected";
  created_sim_ts: number;
  triggered_sim_ts: number | null;
  filled_sim_ts: number | null;
  fill_price: number | null;
  closed_sim_ts: number | null;
  created_time: string;
  triggered_time: string | null;
  filled_time: string | null;
  closed_time: string | null;
  reason: string | null;
  time_in_force: string;
};

export type Position = {
  ticker: string;
  qty: number;
  side: "long" | "short";
  avg_price: number;
  last: number;
  market_value: number;
  unrealized_pnl: number;
};

export type Trade = {
  id: number;
  order_id: number;
  ticker: string;
  side: Side;
  qty: number;
  price: number;
  realized_pnl: number;
  sim_ts: number;
  time: string;
};

export type Account = {
  cash: number;
  start_cash: number;
  buying_power: number;
  reserved_for_orders: number;
  short_collateral: number;
  long_market_value: number;
  equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
};

export type Watchlist = { id: number; name: string; tickers: string[] };

export type AlertCondition = "above" | "below" | "crossing_up" | "crossing_down";

export type Alert = {
  id: number;
  ticker: string;
  condition: AlertCondition;
  price: number;
  note: string;
  enabled: boolean;
  created_sim_ts: number;
  triggered_sim_ts: number | null;
  created_time: string;
  triggered_time: string | null;
  status: "active" | "disabled" | "triggered";
};

export type AlertLogEntry = {
  id: number;
  alert_id: number;
  ticker: string;
  condition: AlertCondition;
  price: number;
  trigger_price: number;
  sim_ts: number;
  time: string;
};

export type EngineEvent = { seq: number; type: string; sim_ts: number; [key: string]: unknown };

export type DrawingKind = "info_line" | "trendline" | "horizontal_line" | "vertical_line";

/** A chart drawing point: a bar's epoch label (may be in the empty future area) and a price. */
export type DrawingPoint = { time: number; price: number; label?: string };

export type Drawing = {
  id: number;
  ticker: string;
  kind: DrawingKind;
  label: string;
  points: DrawingPoint[];
  stats: { price_change: number; pct_change: number; change_cents: number; time_span_seconds: number } | null;
  created_sim_ts: number;
  updated_sim_ts: number;
};
