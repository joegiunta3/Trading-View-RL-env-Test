import { fmtInt, fmtPct, fmtPrice, fmtSigned, toneClass } from "../format";
import type { Clock, Quote } from "../types";
import { Badge } from "./Watchlists";

/** Details for the active symbol, shown under the watchlist. All values are live. */
export function SymbolDetails({ quote, clock }: { quote: Quote | undefined; clock: Clock | null }) {
  if (!quote) return null;
  const status = clock?.market_status;
  const statusLabel = status === "open" ? "Market open" : status === "closed" ? "Session closed" : "Pre-open";
  const dot = status === "open" ? "bg-up" : status === "closed" ? "bg-down" : "bg-warn";
  const stats: [string, string, string?][] = [
    ["Open", fmtPrice(quote.open)],
    ["Prev close", fmtPrice(quote.prev_close)],
    ["High", fmtPrice(quote.high)],
    ["Low", fmtPrice(quote.low)],
    ["Bid", fmtPrice(quote.bid)],
    ["Ask", fmtPrice(quote.ask)],
    ["Volume", fmtInt(quote.volume), "symbol-volume"],
    ["Day range", `${quote.range_pct.toFixed(2)}%`],
  ];
  return (
    <section className="shrink-0 border-t border-line px-3 py-3" aria-label="Symbol details" data-testid="symbol-details">
      <div className="flex items-center gap-2.5">
        <Badge ticker={quote.ticker} size={28} />
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold text-strong" data-testid="symbol-ticker">
            {quote.ticker}
          </div>
          <div className="truncate text-[12px] text-muted">
            {quote.name} · {quote.sector}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2">
        <span className="num text-[26px] leading-none font-semibold text-strong" data-testid="symbol-last">
          {fmtPrice(quote.last)}
        </span>
        <span className="text-[11px] text-muted">USD</span>
        <span className={`num text-[14px] ${toneClass(quote.change)}`} data-testid="symbol-change">
          {fmtSigned(quote.change)} {fmtPct(quote.change_pct)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span>{statusLabel}</span>
        <span className="text-faint">·</span>
        <span>
          Last update <span className="num">{clock?.time ?? "—"}</span>
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {stats.map(([k, v, id]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-text" data-testid={id}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
