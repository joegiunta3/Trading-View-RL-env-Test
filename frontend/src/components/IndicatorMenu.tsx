import { Activity, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CATALOG, LOWER_PANE, defaults, validate } from "../indicators";
import { STRATEGY_CATALOG, strategyDefaults } from "../strategies";
import type { Indicator, Strategy } from "../types";
import { Button } from "./ui";

/**
 * Toolbar "Indicators" menu: a searchable list. One click adds the indicator with standard
 * settings; editing, hiding and removing happen from the indicator's row on the chart.
 */
export function IndicatorMenu({
  indicators,
  onAdd,
  onAddStrategy,
  onError,
}: {
  indicators: Indicator[];
  onAdd: (ind: Indicator) => void;
  onAddStrategy: (s: Strategy) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const count = indicators.filter((i) => i.type !== "volume").length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const items = CATALOG.filter((c) => !q || c.name.toLowerCase().includes(q) || c.type.includes(q));
  const strategyItems = STRATEGY_CATALOG.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || "strategy".includes(q) || q.includes("strateg"),
  );
  const add = (type: Indicator["type"]) => {
    const ind = defaults(type);
    const err = validate(ind, indicators);
    if (err) onError(err);
    else onAdd(ind);
  };

  const group = (title: string, lower: boolean) => {
    const rows = items.filter((c) => LOWER_PANE.has(c.type) === lower);
    if (rows.length === 0) return null;
    return (
      <>
        <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">{title}</div>
        {rows.map((c) => (
          <button
            key={c.type}
            type="button"
            data-testid={`add-${c.type}`}
            onClick={() => add(c.type)}
            className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-hover"
          >
            <span className="text-[13px] text-strong">{c.name}</span>
            <span className="text-[11px] text-muted">{c.desc}</span>
          </button>
        ))}
      </>
    );
  };

  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        data-testid="indicators-button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
      >
        <Activity size={14} /> Indicators
        {count > 0 && <span className="rounded bg-accent-soft px-1 text-[10px] text-accent">{count}</span>}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div
          data-testid="indicators-menu"
          className="absolute top-8 left-0 z-50 flex max-h-[70vh] w-80 flex-col rounded border border-line-strong bg-raised shadow-2xl"
        >
          <div className="relative border-b border-line p-2">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              aria-label="Search indicators"
              data-testid="indicator-search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && items[0] && add(items[0].type)}
              className="h-7 w-full rounded border border-line bg-bg pr-2 pl-7 text-[12px] outline-none focus:border-accent"
            />
          </div>
          <div className="min-h-0 overflow-auto pb-1">
            {group("On the price chart", false)}
            {group("Below the chart", true)}
            {strategyItems.length > 0 && (
              <>
                <div className="mt-1 border-t border-line px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">
                  Strategies
                </div>
                {strategyItems.map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    data-testid={`add-strategy-${c.type}`}
                    onClick={() => onAddStrategy(strategyDefaults(c.type))}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="text-[13px] text-strong">{c.name}</span>
                    <span className="text-[11px] text-muted">{c.desc}</span>
                  </button>
                ))}
              </>
            )}
            {items.length === 0 && strategyItems.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-faint">Nothing matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
