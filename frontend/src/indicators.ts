/**
 * Technical indicators. Same formulas as the server (app/indicators.py), which graders use, so
 * the values in the chart legends match what tasks are checked against.
 */
import type { Bar, Indicator } from "./types";

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` available values (nulls are skipped). */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  const seed: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function bollinger(bars: Bar[], period: number, k: number) {
  const closes = bars.map((b) => b.c);
  const middle = sma(closes, period);
  const upper: Series = new Array(bars.length).fill(null);
  const lower: Series = new Array(bars.length).fill(null);
  middle.forEach((m, i) => {
    if (m == null) return;
    let ss = 0;
    for (let j = i - period + 1; j <= i; j++) ss += (closes[j] - m) ** 2;
    const sd = Math.sqrt(ss / period);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  });
  return { upper, middle, lower };
}

/** Session VWAP: cumulative typical price × volume over volume, reset when the date changes. */
export function vwap(bars: Bar[]): Series {
  const out: Series = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  let day = "";
  bars.forEach((b, i) => {
    if (b.date !== day) {
      day = b.date;
      pv = 0;
      vol = 0;
    }
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vol += b.v;
    out[i] = vol ? pv / vol : null;
  });
  return out;
}

/** Wilder's RSI: average gain/loss seeded with the n-bar mean, then RMA-smoothed. */
export function rsi(bars: Bar[], period: number): Series {
  const c = bars.map((b) => b.c);
  const out: Series = new Array(bars.length).fill(null);
  if (c.length <= period) return out;
  const gain = (i: number) => Math.max(c[i] - c[i - 1], 0);
  const loss = (i: number) => Math.max(c[i - 1] - c[i], 0);
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    g += gain(i);
    l += loss(i);
  }
  g /= period;
  l /= period;
  for (let i = period; i < c.length; i++) {
    if (i > period) {
      g = (g * (period - 1) + gain(i)) / period;
      l = (l * (period - 1) + loss(i)) / period;
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(bars: Bar[], fast: number, slow: number, signal: number) {
  const closes = bars.map((b) => b.c);
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: Series = ef.map((a, i) => (a == null || es[i] == null ? null : a - (es[i] as number)));
  const sig = ema(line, signal);
  const histogram: Series = line.map((a, i) => (a == null || sig[i] == null ? null : a - (sig[i] as number)));
  return { macd: line, signal: sig, histogram };
}

export function kdj(bars: Bar[], period: number, m1: number, m2: number) {
  const k: Series = new Array(bars.length).fill(null);
  const d: Series = new Array(bars.length).fill(null);
  const j: Series = new Array(bars.length).fill(null);
  let kv = 50;
  let dv = 50;
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let x = i - period + 1; x <= i; x++) {
      hh = Math.max(hh, bars[x].h);
      ll = Math.min(ll, bars[x].l);
    }
    const rsv = hh === ll ? 50 : ((bars[i].c - ll) / (hh - ll)) * 100;
    kv = ((m1 - 1) * kv + rsv) / m1;
    dv = ((m2 - 1) * dv + kv) / m2;
    k[i] = kv;
    d[i] = dv;
    j[i] = 3 * kv - 2 * dv;
  }
  return { k, d, j };
}

/** Named output series for one indicator config. */
export function compute(bars: Bar[], ind: Indicator): Record<string, Series> {
  switch (ind.type) {
    case "sma":
      return { sma: sma(bars.map((b) => b.c), ind.period) };
    case "ema":
      return { ema: ema(bars.map((b) => b.c), ind.period) };
    case "bb":
      return bollinger(bars, ind.period, ind.stddev);
    case "vwap":
      return { vwap: vwap(bars) };
    case "rsi":
      return { rsi: rsi(bars, ind.period) };
    case "macd":
      return macd(bars, ind.fast, ind.slow, ind.signal);
    case "kdj":
      return kdj(bars, ind.period, ind.k, ind.d);
    case "volume":
      return { volume: bars.map((b) => b.v) };
  }
}

export const LOWER_PANE = new Set(["rsi", "macd", "kdj"]);

/** Short display name, e.g. "MACD 12 26 9". */
export function indicatorLabel(ind: Indicator): string {
  switch (ind.type) {
    case "volume":
      return "Vol";
    case "vwap":
      return "VWAP";
    case "bb":
      return `BB ${ind.period} ${ind.stddev}`;
    case "macd":
      return `MACD ${ind.fast} ${ind.slow} ${ind.signal}`;
    case "kdj":
      return `KDJ ${ind.period} ${ind.k} ${ind.d}`;
    default:
      return `${ind.type.toUpperCase()} ${ind.period}`;
  }
}

/** Stable id for test ids and React keys, e.g. "macd-12-26-9", "bb-20-2". */
export function indicatorKey(ind: Indicator): string {
  switch (ind.type) {
    case "volume":
    case "vwap":
      return ind.type;
    case "bb":
      return `bb-${ind.period}-${ind.stddev}`;
    case "macd":
      return `macd-${ind.fast}-${ind.slow}-${ind.signal}`;
    case "kdj":
      return `kdj-${ind.period}-${ind.k}-${ind.d}`;
    default:
      return `${ind.type}-${ind.period}`;
  }
}
