import { Check, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { fmtPct, fmtPrice, fmtSigned, toneClass } from "../format";
import type { Quote, SymbolInfo, Watchlist } from "../types";
import { Button, Empty, ErrorText, IconButton, Input, td } from "./ui";

type Mode = "view" | "new" | "rename" | "delete";

export function Watchlists({
  lists,
  quotes,
  symbols,
  active,
  onSymbol,
  reload,
}: {
  lists: Watchlist[];
  quotes: Record<string, Quote>;
  symbols: SymbolInfo[];
  active: string;
  onSymbol: (t: string) => void;
  reload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [addTicker, setAddTicker] = useState("");
  const [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null);

  const current = lists.find((l) => l.id === selected) ?? lists[0];
  const sectorOf = (t: string) => symbols.find((s) => s.ticker === t)?.sector ?? "Other";

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return false;
    }
  };

  const nameError = (n: string, exclude?: number) => {
    const t = n.trim();
    if (!t) return "Enter a name.";
    if (t.length > 40) return "Names can be at most 40 characters.";
    if (lists.some((l) => l.id !== exclude && l.name.toLowerCase() === t.toLowerCase()))
      return `A watchlist named "${t}" already exists.`;
    return "";
  };

  const submitName = async () => {
    const err = nameError(name, mode === "rename" ? current?.id : undefined);
    if (err) return setError(err);
    if (mode === "new") {
      let created: number | null = null;
      await run(async () => {
        created = (await api.createWatchlist(name.trim())).id;
      });
      if (created != null) setSelected(created);
    } else if (current) {
      await run(() => api.renameWatchlist(current.id, name.trim()));
    }
    setMode("view");
  };

  const add = async () => {
    if (!current) return;
    const t = addTicker.trim().toUpperCase();
    if (!t) return;
    if (!symbols.some((s) => s.ticker === t)) return setError(`Unknown symbol "${t}".`);
    if (current.tickers.includes(t)) return setError(`${t} is already in ${current.name}.`);
    setAddTicker(""); // clear now so a slow response never wipes newer typing
    if (!(await run(() => api.addToWatchlist(current.id, t)))) setAddTicker(t);
  };

  const pick = (m: Mode) => {
    setMenuOpen(false);
    setError("");
    setMode(m);
    setName(m === "rename" ? (current?.name ?? "") : "");
  };

  // Group rows by sector, in order of first appearance in the list.
  const groups: { sector: string; tickers: string[] }[] = [];
  for (const t of current?.tickers ?? []) {
    const sector = sectorOf(t);
    const g = groups.find((x) => x.sector === sector);
    if (g) g.tickers.push(t);
    else groups.push({ sector, tickers: [t] });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="watchlists">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        {mode === "new" || mode === "rename" ? (
          <>
            <Input
              autoFocus
              aria-label="Watchlist name"
              data-testid="watchlist-name-input"
              placeholder={mode === "new" ? "New watchlist name" : "Watchlist name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
                if (e.key === "Escape") setMode("view");
              }}
            />
            <IconButton label="Save name" data-testid="watchlist-name-save" onClick={submitName}>
              <Check size={15} />
            </IconButton>
            <IconButton label="Cancel" onClick={() => (setMode("view"), setError(""))}>
              <X size={15} />
            </IconButton>
          </>
        ) : mode === "delete" && current ? (
          <div className="flex flex-1 items-center gap-1.5 text-[12px]">
            <span className="flex-1">Delete “{current.name}”?</span>
            <Button
              variant="danger"
              data-testid="watchlist-delete-confirm"
              onClick={async () => {
                if (lists.length <= 1) {
                  setError("You must keep at least one watchlist.");
                } else if (await run(() => api.deleteWatchlist(current.id))) {
                  setSelected(null);
                }
                setMode("view");
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div className="relative min-w-0 flex-1">
              <select
                aria-label="Watchlist"
                data-testid="watchlist-select"
                value={current?.id ?? ""}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="h-8 w-full cursor-pointer appearance-none truncate rounded bg-transparent pr-6 pl-1 text-[14px] font-semibold text-strong outline-none hover:bg-hover"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-muted" />
            </div>
            <IconButton
              label="Add symbol"
              active={adding}
              data-testid="watchlist-add-toggle"
              onClick={() => (setAdding((a) => !a), setError(""))}
            >
              <Plus size={16} />
            </IconButton>
            <div ref={menu} className="relative">
              <IconButton
                label="Watchlist options"
                data-testid="watchlist-menu"
                active={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <MoreHorizontal size={16} />
              </IconButton>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute top-8 right-0 z-40 w-44 rounded border border-line-strong bg-raised py-1 shadow-2xl"
                >
                  <MenuItem testId="watchlist-new" icon={<Plus size={13} />} onClick={() => pick("new")}>
                    New watchlist
                  </MenuItem>
                  <MenuItem testId="watchlist-rename" icon={<Pencil size={13} />} onClick={() => pick("rename")}>
                    Rename
                  </MenuItem>
                  <MenuItem testId="watchlist-delete" icon={<Trash2 size={13} />} onClick={() => pick("delete")}>
                    Delete
                  </MenuItem>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {adding && mode === "view" && (
        <div className="flex gap-1 px-2 pb-2">
          <Input
            autoFocus
            aria-label="Add symbol to watchlist"
            data-testid="watchlist-add-input"
            placeholder="Symbol, e.g. MSFT"
            list="cv-symbols"
            value={addTicker}
            onChange={(e) => setAddTicker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="uppercase placeholder:normal-case"
          />
          <Button variant="primary" data-testid="watchlist-add" onClick={add}>
            Add
          </Button>
        </div>
      )}
      <div className="px-2">
        <ErrorText testId="watchlist-error">{error}</ErrorText>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {current && current.tickers.length === 0 ? (
          <Empty>This watchlist is empty. Use + to add a symbol.</Empty>
        ) : (
          <table className="w-full border-collapse" data-testid="watchlist-table">
            <thead>
              <tr className="text-[11px] text-muted">
                <th className="sticky top-0 z-10 bg-panel px-2 py-1.5 text-left font-normal">Symbol</th>
                <th className="sticky top-0 z-10 bg-panel px-2 py-1.5 text-right font-normal">Last</th>
                <th className="sticky top-0 z-10 bg-panel px-2 py-1.5 text-right font-normal">Chg</th>
                <th className="sticky top-0 z-10 bg-panel px-2 py-1.5 text-right font-normal">Chg%</th>
                <th className="sticky top-0 z-10 w-6 bg-panel" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.sector}>
                  <tr>
                    <td colSpan={5} className="px-2 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-faint uppercase">
                      {g.sector}
                    </td>
                  </tr>
                  {g.tickers.map((t) => {
                    const q = quotes[t];
                    const isActive = t === active;
                    return (
                      <tr
                        key={t}
                        data-testid={`watch-row-${t}`}
                        aria-selected={isActive}
                        onClick={() => onSymbol(t)}
                        className={`group cursor-pointer hover:bg-hover ${isActive ? "bg-accent-soft" : ""}`}
                      >
                        <td className={`${td} border-l-2 ${isActive ? "border-accent" : "border-transparent"}`}>
                          <span className="flex items-center gap-2">
                            <Badge ticker={t} />
                            <span className="font-semibold text-strong">{t}</span>
                          </span>
                        </td>
                        <td className={`${td} num text-right text-strong`}>{fmtPrice(q?.last)}</td>
                        <td className={`${td} num text-right ${toneClass(q?.change ?? 0)}`}>
                          {q ? fmtSigned(q.change) : "—"}
                        </td>
                        <td className={`${td} num text-right ${toneClass(q?.change ?? 0)}`}>
                          {q ? fmtPct(q.change_pct) : "—"}
                        </td>
                        <td className="w-6 pr-1">
                          <button
                            type="button"
                            aria-label={`Remove ${t} from watchlist`}
                            data-testid={`watch-remove-${t}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (current) run(() => api.removeFromWatchlist(current.id, t));
                            }}
                            className="rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-down focus:opacity-100"
                          >
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  testId,
  icon,
  onClick,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-hover"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}

/** Neutral monogram badge (no company logos). */
export function Badge({ ticker, size = 20 }: { ticker: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised font-semibold text-muted"
    >
      {ticker.slice(0, 2)}
    </span>
  );
}
