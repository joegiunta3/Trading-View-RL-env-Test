import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtInt, fmtPct, fmtPrice, toneClass } from "../format";
import type { Quote } from "../types";
import { Field, Input, Select, td, th } from "./ui";

type SortKey = "ticker" | "sector" | "last" | "change_pct" | "volume" | "range_pct";
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "ticker", label: "Symbol", numeric: false },
  { key: "sector", label: "Sector", numeric: false },
  { key: "last", label: "Last", numeric: true },
  { key: "change_pct", label: "Chg%", numeric: true },
  { key: "volume", label: "Volume", numeric: true },
  { key: "range_pct", label: "Range%", numeric: true },
];

type Filters = { sector: string; minPrice: string; maxPrice: string; minChg: string; maxChg: string; minVol: string };

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function Screener({
  quotes,
  sectors,
  onSymbol,
}: {
  quotes: Record<string, Quote>;
  sectors: string[];
  onSymbol: (t: string) => void;
}) {
  const [f, setF] = useState<Filters>({ sector: "", minPrice: "", maxPrice: "", minChg: "", maxChg: "", minVol: "" });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "ticker", dir: "asc" });

  const rows = useMemo(() => {
    const checks: [number | null, (q: Quote, v: number) => boolean][] = [
      [num(f.minPrice), (q, v) => q.last >= v],
      [num(f.maxPrice), (q, v) => q.last <= v],
      [num(f.minChg), (q, v) => q.change_pct >= v],
      [num(f.maxChg), (q, v) => q.change_pct <= v],
      [num(f.minVol), (q, v) => q.volume >= v],
    ];
    const out = Object.values(quotes).filter(
      (q) =>
        (!f.sector || q.sector === f.sector) && checks.every(([v, ok]) => v == null || Number.isNaN(v) || ok(q, v)),
    );
    const k = sort.key;
    out.sort((a, b) => {
      const c = typeof a[k] === "string" ? String(a[k]).localeCompare(String(b[k])) : (a[k] as number) - (b[k] as number);
      return (sort.dir === "asc" ? c : -c) || a.ticker.localeCompare(b.ticker);
    });
    return out;
  }, [quotes, f, sort]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="screener">
      <div className="grid grid-cols-3 gap-2 border-b border-line p-2">
        <Field label="Sector">
          <Select data-testid="screener-sector" value={f.sector} onChange={set("sector")}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Min price">
          <Input type="number" data-testid="screener-min-price" value={f.minPrice} onChange={set("minPrice")} />
        </Field>
        <Field label="Max price">
          <Input type="number" data-testid="screener-max-price" value={f.maxPrice} onChange={set("maxPrice")} />
        </Field>
        <Field label="Min chg %">
          <Input type="number" data-testid="screener-min-chg" value={f.minChg} onChange={set("minChg")} />
        </Field>
        <Field label="Max chg %">
          <Input type="number" data-testid="screener-max-chg" value={f.maxChg} onChange={set("maxChg")} />
        </Field>
        <Field label="Min volume">
          <Input type="number" data-testid="screener-min-volume" value={f.minVol} onChange={set("minVol")} />
        </Field>
      </div>
      <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted">
        <span data-testid="screener-count">
          {rows.length} of {Object.keys(quotes).length} symbols
        </span>
        <span>Since prior close · live</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse" data-testid="screener-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const activeSort = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`${th} ${c.numeric ? "text-right" : ""}`}
                    aria-sort={activeSort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      data-testid={`screener-sort-${c.key}`}
                      onClick={() =>
                        setSort((s) =>
                          s.key === c.key
                            ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
                            : { key: c.key, dir: c.numeric ? "desc" : "asc" },
                        )
                      }
                      className={`inline-flex items-center gap-0.5 uppercase hover:text-text ${activeSort ? "text-text" : ""}`}
                    >
                      {c.label}
                      {activeSort && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr
                key={q.ticker}
                data-testid={`screener-row-${q.ticker}`}
                onClick={() => onSymbol(q.ticker)}
                className="cursor-pointer border-b border-line/50 hover:bg-hover"
              >
                <td className={`${td} font-semibold text-strong`} title={q.name}>
                  {q.ticker}
                </td>
                <td className={`${td} text-muted`}>{q.sector}</td>
                <td className={`${td} num text-right`}>{fmtPrice(q.last)}</td>
                <td className={`${td} num text-right ${toneClass(q.change_pct)}`}>{fmtPct(q.change_pct)}</td>
                <td className={`${td} num text-right`}>{fmtInt(q.volume)}</td>
                <td className={`${td} num text-right`}>{q.range_pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
