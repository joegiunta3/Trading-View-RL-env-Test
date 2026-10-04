export type AppConfig = {
  app_name: string;
  session_date: string;
  timeframes: string[];
  sectors: string[];
};

export type MarketStatus = "pre-open" | "open" | "closed";

export type Clock = {
  sim_now: number;
  time: string;
  date: string;
  market_status: MarketStatus;
  session_open: string;
  session_close: string;
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

export type Indicator = { type: "volume" } | { type: "sma"; period: number };

export type ChartPrefs = { ticker: string; timeframe: string; indicators: Indicator[] };

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
