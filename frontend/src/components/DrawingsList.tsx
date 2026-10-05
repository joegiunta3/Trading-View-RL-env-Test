import { Trash2 } from "lucide-react";
import { fmtPct, fmtPrice, fmtSigned } from "../format";
import type { Drawing } from "../types";
import { ToolIcon } from "./LeftRail";
import { Empty } from "./ui";

/** Every drawing as text: tool, symbol, points and (for two-point lines) the price change. */
export function DrawingsList({
  drawings,
  active,
  selected,
  onSelect,
  onDelete,
}: {
  drawings: Drawing[];
  active: string;
  selected: number | null;
  onSelect: (d: Drawing) => void;
  onDelete: (id: number) => void;
}) {
  if (drawings.length === 0)
    return <Empty>No drawings yet. Pick a line tool in the left toolbar and click on a chart.</Empty>;
  const tickers = [...new Set(drawings.map((d) => d.ticker))].sort((a, b) =>
    a === active ? -1 : b === active ? 1 : a.localeCompare(b),
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="drawings-list">
      {tickers.map((t) => (
        <section key={t}>
          <div className="sticky top-0 z-10 bg-panel px-2 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">
            {t}
          </div>
          {drawings
            .filter((d) => d.ticker === t)
            .map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                data-testid={`drawing-row-${d.id}`}
                aria-selected={selected === d.id}
                onClick={() => onSelect(d)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(d)}
                className={`group flex cursor-pointer gap-2 border-b border-line/50 px-2 py-1.5 hover:bg-hover ${
                  selected === d.id ? "bg-accent-soft" : ""
                }`}
              >
                <span className="mt-0.5 text-accent">
                  <ToolIcon kind={d.kind} size={16} />
                </span>
                <div className="min-w-0 flex-1 text-[12px]">
                  <div className="font-medium text-strong">{d.label}</div>
                  {d.points.map((p, i) => (
                    <div key={i} className="num text-muted" data-testid={`drawing-row-${d.id}-point-${i}`}>
                      {d.kind === "vertical_line" ? p.label : d.kind === "horizontal_line" ? fmtPrice(p.price) : `${p.label} · ${fmtPrice(p.price)}`}
                    </div>
                  ))}
                  {d.stats && (
                    <div className="num text-text" data-testid={`drawing-row-${d.id}-stats`}>
                      {fmtSigned(d.stats.price_change)} ({fmtPct(d.stats.pct_change)})
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${d.label}`}
                  data-testid={`drawing-row-delete-${d.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(d.id);
                  }}
                  className="self-start rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:text-down focus:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
