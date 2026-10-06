/** Built-in backtest strategies. The backtest itself runs on the server (app/strategies.py). */
import type { ParamSpec } from "./indicators";
import type { Strategy, StrategyType } from "./types";

export const DIRECTION_OPTIONS = [
  { value: "both", label: "Long & short" },
  { value: "long", label: "Long only" },
  { value: "short", label: "Short only" },
];

/** Defaults and bounds match the server (STRATEGY_PARAMS in app/episode.py). */
export const STRATEGY_CATALOG: { type: StrategyType; name: string; desc: string; params: ParamSpec[] }[] = [
  {
    type: "ma_cross",
    name: "MA Crossover",
    desc: "Long when the fast SMA crosses above the slow SMA, short when it crosses below",
    params: [
      { name: "fast", label: "Fast length", def: 9, min: 1, max: 200, int: true },
      { name: "slow", label: "Slow length", def: 21, min: 2, max: 400, int: true },
      { name: "qty", label: "Order size (shares)", def: 100, min: 1, max: 100000, int: true },
    ],
  },
  {
    type: "rsi_reversal",
    name: "RSI Reversal",
    desc: "Long when RSI crosses up through oversold, short when it crosses down through overbought",
    params: [
      { name: "period", label: "RSI length", def: 14, min: 2, max: 100, int: true },
      { name: "oversold", label: "Oversold", def: 30, min: 1, max: 99, int: true },
      { name: "overbought", label: "Overbought", def: 70, min: 1, max: 99, int: true },
      { name: "qty", label: "Order size (shares)", def: 100, min: 1, max: 100000, int: true },
    ],
  },
];

export const strategyEntry = (type: StrategyType) => STRATEGY_CATALOG.find((s) => s.type === type)!;

export function strategyDefaults(type: StrategyType): Strategy {
  return {
    type,
    ...Object.fromEntries(strategyEntry(type).params.map((p) => [p.name, p.def])),
    direction: "both",
  } as Strategy;
}

/** e.g. "MA Crossover 9 21" or "RSI Reversal 14 30 70". */
export function strategyLabel(s: Strategy): string {
  return s.type === "ma_cross"
    ? `MA Crossover ${s.fast} ${s.slow}`
    : `RSI Reversal ${s.period} ${s.oversold} ${s.overbought}`;
}

export const strategyKey = (s: Strategy) => strategyLabel(s).toLowerCase().replace(/\s+/g, "-");

/** Why a strategy config is invalid, or null. */
export function validateStrategy(s: Strategy): string | null {
  for (const p of strategyEntry(s.type).params) {
    const v = (s as unknown as Record<string, number>)[p.name];
    if (!Number.isInteger(v) || v < p.min || v > p.max) return `${p.label} must be a whole number from ${p.min} to ${p.max}.`;
  }
  if (s.type === "ma_cross" && s.fast >= s.slow) return "Fast length must be shorter than slow length.";
  if (s.type === "rsi_reversal" && s.oversold >= s.overbought) return "Oversold must be below overbought.";
  return null;
}
