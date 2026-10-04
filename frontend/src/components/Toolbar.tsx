import { Activity, AlarmClockPlus, ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { smaColors } from "../theme";
import type { Clock, Indicator, SymbolInfo } from "../types";
import { Logo } from "./Logo";
import { Button, Input } from "./ui";

type Props = {
  appName: string;
  symbols: SymbolInfo[];
  active: string;
  onSymbol: (t: string) => void;
  timeframes: string[];
  timeframe: string;
  onTimeframe: (tf: string) => void;
  indicators: Indicator[];
  onIndicators: (inds: Indicator[]) => void;
  clock: Clock | null;
  connected: boolean;
  onAlert: () => void;
};

export function Toolbar(p: Props) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-3" data-testid="toolbar">
      <Logo name={p.appName} />
      <Divider />
      <SymbolSearch symbols={p.symbols} active={p.active} onSelect={p.onSymbol} />
      <Divider />
      <div className="flex items-center gap-0.5" role="group" aria-label="Timeframe">
        {p.timeframes.map((tf) => (
          <button
            key={tf}
            type="button"
            data-testid={`tf-${tf}`}
            aria-pressed={tf === p.timeframe}
            onClick={() => p.onTimeframe(tf)}
            className={`h-7 rounded px-2 text-[12px] font-medium transition-colors ${
              tf === p.timeframe ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      <Divider />
      <IndicatorMenu indicators={p.indicators} onChange={p.onIndicators} />
      <Button variant="ghost" data-testid="toolbar-alert" onClick={p.onAlert}>
        <AlarmClockPlus size={14} /> Alert
      </Button>
      <div className="flex-1" />
      <ClockDisplay clock={p.clock} connected={p.connected} />
    </header>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-line" />;
}

function SymbolSearch({
  symbols,
  active,
  onSelect,
}: {
  symbols: SymbolInfo[];
  active: string;
  onSelect: (t: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols;
    return symbols
      .filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.ticker.toLowerCase().startsWith(q)) - Number(!b.ticker.toLowerCase().startsWith(q)));
  }, [query, symbols]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (t: string) => {
    onSelect(t);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative w-56">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
      <input
        data-testid="symbol-search"
        aria-label="Search symbol"
        placeholder={active || "Symbol"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
          else if (e.key === "Enter" && matches[cursor]) choose(matches[cursor].ticker);
          else if (e.key === "Escape") setOpen(false);
        }}
        className="h-7 w-full rounded border border-line bg-bg pr-2 pl-7 text-[12px] font-semibold text-strong uppercase outline-none placeholder:text-strong focus:border-accent focus:placeholder:text-faint"
      />
      {open && (
        <ul
          role="listbox"
          data-testid="symbol-results"
          className="absolute top-8 left-0 z-50 max-h-80 w-80 overflow-auto rounded border border-line-strong bg-raised py-1 shadow-2xl"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-[12px] text-faint">No matching symbols</li>}
          {matches.map((s, i) => (
            <li
              key={s.ticker}
              role="option"
              aria-selected={i === cursor}
              data-testid={`symbol-option-${s.ticker}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s.ticker);
              }}
              onMouseEnter={() => setCursor(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 ${i === cursor ? "bg-hover" : ""}`}
            >
              <span className="w-12 font-semibold text-strong">{s.ticker}</span>
              <span className="flex-1 truncate text-muted">{s.name}</span>
              <span className="text-[11px] text-faint">{s.sector}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IndicatorMenu({ indicators, onChange }: { indicators: Indicator[]; onChange: (i: Indicator[]) => void }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("20");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const hasVolume = indicators.some((i) => i.type === "volume");
  const smas = indicators.filter((i): i is { type: "sma"; period: number } => i.type === "sma");

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const addSma = () => {
    const n = Number(period);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setError("Period must be a whole number from 1 to 500.");
    if (smas.some((s) => s.period === n)) return setError(`SMA ${n} is already on the chart.`);
    if (indicators.length >= 10) return setError("At most 10 indicators.");
    setError("");
    onChange([...indicators, { type: "sma", period: n }]);
  };

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" data-testid="indicators-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Activity size={14} /> Indicators
        {smas.length > 0 && <span className="rounded bg-accent-soft px-1 text-[10px] text-accent">{smas.length}</span>}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div
          data-testid="indicators-menu"
          className="absolute top-8 left-0 z-50 w-64 rounded border border-line-strong bg-raised p-3 shadow-2xl"
        >
          <label className="flex cursor-pointer items-center justify-between py-1">
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
          <div className="my-2 h-px bg-line" />
          <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted uppercase">Simple moving average</div>
          <ul className="mb-2 flex flex-col gap-1" data-testid="sma-list">
            {smas.length === 0 && <li className="text-[12px] text-faint">None</li>}
            {smas.map((s, i) => (
              <li key={s.period} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-0.5 w-4 rounded" style={{ background: smaColors[i % smaColors.length] }} />
                  SMA {s.period}
                </span>
                <button
                  type="button"
                  aria-label={`Remove SMA ${s.period}`}
                  data-testid={`remove-sma-${s.period}`}
                  onClick={() => onChange(indicators.filter((x) => !(x.type === "sma" && x.period === s.period)))}
                  className="rounded p-0.5 text-muted hover:bg-hover hover:text-down"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={1}
              max={500}
              aria-label="SMA period"
              data-testid="sma-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSma()}
            />
            <Button variant="primary" data-testid="add-sma" onClick={addSma}>
              <Plus size={13} /> Add
            </Button>
          </div>
          {error && <p className="mt-1.5 text-[11px] text-down">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ClockDisplay({ clock, connected }: { clock: Clock | null; connected: boolean }) {
  const status = clock?.market_status;
  const label = status === "open" ? "Market open" : status === "closed" ? "Session closed" : "Pre-open";
  const dot = status === "open" ? "bg-up" : status === "closed" ? "bg-down" : "bg-warn";
  return (
    <div className="flex items-center gap-3" data-testid="clock">
      {!connected && <span className="text-[11px] text-warn">Reconnecting…</span>}
      <span
        data-testid="simulated-badge"
        title="All prices, volumes and events are simulated. Ticker names are used for realism only; this is not real market data."
        className="rounded border border-warn/50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-warn uppercase"
      >
        Simulated data
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-muted" data-testid="market-status">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="text-[11px] text-faint">{clock?.date ?? ""}</span>
      <span className="num rounded bg-bg px-2 py-1 text-[13px] text-strong" data-testid="clock-time">
        {clock?.time ?? "--:--:--"}
      </span>
    </div>
  );
}
