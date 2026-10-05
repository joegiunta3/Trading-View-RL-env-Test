import { Activity, ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOWER_PANE, indicatorKey, indicatorLabel } from "../indicators";
import type { Indicator, IndicatorType } from "../types";
import { Button } from "./ui";

type ParamSpec = { name: string; label: string; def: number; min: number; max: number; int: boolean };

/** Same defaults and bounds as the server (app/episode.py INDICATOR_PARAMS). */
const CATALOG: { type: Exclude<IndicatorType, "volume">; name: string; params: ParamSpec[] }[] = [
  { type: "sma", name: "Moving Average (SMA)", params: [{ name: "period", label: "Length", def: 20, min: 1, max: 500, int: true }] },
  { type: "ema", name: "Exponential MA (EMA)", params: [{ name: "period", label: "Length", def: 20, min: 1, max: 500, int: true }] },
  {
    type: "bb",
    name: "Bollinger Bands",
    params: [
      { name: "period", label: "Length", def: 20, min: 2, max: 500, int: true },
      { name: "stddev", label: "StdDev", def: 2, min: 0.5, max: 5, int: false },
    ],
  },
  { type: "vwap", name: "VWAP", params: [] },
  { type: "rsi", name: "RSI", params: [{ name: "period", label: "Length", def: 14, min: 2, max: 100, int: true }] },
  {
    type: "macd",
    name: "MACD",
    params: [
      { name: "fast", label: "Fast", def: 12, min: 1, max: 100, int: true },
      { name: "slow", label: "Slow", def: 26, min: 2, max: 200, int: true },
      { name: "signal", label: "Signal", def: 9, min: 1, max: 100, int: true },
    ],
  },
  {
    type: "kdj",
    name: "KDJ",
    params: [
      { name: "period", label: "Length", def: 9, min: 1, max: 100, int: true },
      { name: "k", label: "K", def: 3, min: 1, max: 20, int: true },
      { name: "d", label: "D", def: 3, min: 1, max: 20, int: true },
    ],
  },
];
const MAX_INDICATORS = 10;
const MAX_LOWER = 3;

export function IndicatorMenu({ indicators, onChange }: { indicators: Indicator[]; onChange: (i: Indicator[]) => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(CATALOG.flatMap((c) => c.params.map((p) => [`${c.type}-${p.name}`, String(p.def)]))),
  );
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const hasVolume = indicators.some((i) => i.type === "volume");
  const studies = indicators.filter((i) => i.type !== "volume");

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const add = (entry: (typeof CATALOG)[number]) => {
    const ind: Record<string, unknown> = { type: entry.type };
    for (const p of entry.params) {
      const n = Number(values[`${entry.type}-${p.name}`]);
      if (!Number.isFinite(n) || (p.int && !Number.isInteger(n)) || n < p.min || n > p.max) {
        return setError(`${entry.name} ${p.label.toLowerCase()} must be ${p.int ? "a whole number" : "a number"} from ${p.min} to ${p.max}.`);
      }
      ind[p.name] = n;
    }
    const next = ind as Indicator;
    if (next.type === "macd" && next.fast >= next.slow) return setError("MACD fast length must be shorter than slow length.");
    if (indicators.some((i) => indicatorKey(i) === indicatorKey(next))) return setError(`${indicatorLabel(next)} is already on this chart.`);
    if (indicators.length >= MAX_INDICATORS) return setError(`At most ${MAX_INDICATORS} indicators.`);
    if (LOWER_PANE.has(next.type) && indicators.filter((i) => LOWER_PANE.has(i.type)).length >= MAX_LOWER)
      return setError(`At most ${MAX_LOWER} lower panes (RSI, MACD, KDJ) per chart.`);
    setError("");
    onChange([...indicators, next]);
  };

  const section = (title: string, lower: boolean) => (
    <>
      <div className="mt-2 mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">{title}</div>
      {CATALOG.filter((c) => LOWER_PANE.has(c.type) === lower).map((c) => (
        <div key={c.type} className="flex items-center gap-1.5 py-1" data-testid={`ind-row-${c.type}`}>
          <span className="w-36 shrink-0 text-[12px] text-text">{c.name}</span>
          <div className="flex flex-1 gap-1">
            {c.params.map((p) => (
              <input
                key={p.name}
                type="number"
                step={p.int ? 1 : 0.1}
                min={p.min}
                max={p.max}
                title={p.label}
                aria-label={`${c.name} ${p.label}`}
                data-testid={`${c.type}-${p.name}`}
                value={values[`${c.type}-${p.name}`]}
                onChange={(e) => setValues((v) => ({ ...v, [`${c.type}-${p.name}`]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(c)}
                className="h-6 w-12 min-w-0 rounded border border-line bg-bg px-1 text-[11px] outline-none focus:border-accent"
              />
            ))}
          </div>
          <Button variant="subtle" data-testid={`add-${c.type}`} onClick={() => add(c)} className="h-6 px-1.5" title={`Add ${c.name}`}>
            <Plus size={12} />
          </Button>
        </div>
      ))}
    </>
  );

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" data-testid="indicators-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Activity size={14} /> Indicators
        {studies.length > 0 && <span className="rounded bg-accent-soft px-1 text-[10px] text-accent">{studies.length}</span>}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div
          data-testid="indicators-menu"
          className="absolute top-8 left-0 z-50 max-h-[70vh] w-[380px] overflow-auto rounded border border-line-strong bg-raised p-3 shadow-2xl"
        >
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">On this chart</div>
          <ul className="flex flex-col gap-0.5" data-testid="active-indicators">
            {studies.length === 0 && <li className="text-[12px] text-faint">No indicators yet.</li>}
            {studies.map((ind) => (
              <li key={indicatorKey(ind)} className="flex items-center justify-between text-[12px]">
                <span>{indicatorLabel(ind)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${indicatorLabel(ind)}`}
                  data-testid={`remove-${indicatorKey(ind)}`}
                  onClick={() => onChange(indicators.filter((x) => indicatorKey(x) !== indicatorKey(ind)))}
                  className="rounded p-0.5 text-muted hover:bg-hover hover:text-down"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-2 flex cursor-pointer items-center justify-between border-t border-line pt-2 text-[12px]">
            <span>Volume</span>
            <input
              type="checkbox"
              data-testid="toggle-volume"
              checked={hasVolume}
              onChange={(e) =>
                onChange(e.target.checked ? [{ type: "volume" }, ...indicators] : indicators.filter((i) => i.type !== "volume"))
              }
              className="accent-[var(--cv-accent)]"
            />
          </label>
          {section("Add on price", false)}
          {section("Add below chart", true)}
          {error && (
            <p role="alert" data-testid="indicator-error" className="mt-2 text-[11px] text-down">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
