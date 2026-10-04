import { X } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "../api";
import { fmtInt, fmtPrice, fmtSignedUsd, fmtUsd, simTime, toneClass } from "../format";
import type { Account, Order, Position, Side, Trade } from "../types";
import { Empty, ErrorText, Tabs, td, th } from "./ui";

type Tab = "positions" | "orders" | "history" | "pnl";

export function BottomPanel({
  account,
  positions,
  orders,
  trades,
  tradingOpen,
  onSymbol,
  onClosePosition,
  reload,
  children,
}: {
  account: Account | null;
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  tradingOpen: boolean;
  onSymbol: (t: string) => void;
  onClosePosition: (ticker: string, side: Side, qty: number) => void;
  reload: () => void;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [error, setError] = useState("");
  const working = orders.filter((o) => o.status === "working").length;

  const cancel = async (id: number) => {
    try {
      setError("");
      await api.cancelOrder(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel order.");
    }
    reload();
  };

  return (
    <section className="flex h-72 shrink-0 border-t border-line bg-panel" data-testid="bottom-panel">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center">
          <div className="flex-1">
            <Tabs
              idPrefix="bottom"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "positions", label: `Positions${positions.length ? ` (${positions.length})` : ""}` },
                { id: "orders", label: `Orders${working ? ` (${working})` : ""}` },
                { id: "history", label: "History" },
                { id: "pnl", label: "P&L" },
              ]}
            />
          </div>
          {account && (
            <div className="flex h-9 items-center gap-4 border-b border-line px-3 text-[11px]" data-testid="account-strip">
              <span className="text-muted">
                Equity <span className="num text-strong">{fmtUsd(account.equity)}</span>
              </span>
              <span className="text-muted">
                Buying power <span className="num text-strong" data-testid="buying-power">{fmtUsd(account.buying_power)}</span>
              </span>
              <span className="text-muted">
                P&L <span className={`num ${toneClass(account.total_pnl)}`}>{fmtSignedUsd(account.total_pnl)}</span>
              </span>
            </div>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "positions" && (
            <Positions positions={positions} tradingOpen={tradingOpen} onSymbol={onSymbol} onClose={onClosePosition} />
          )}
          {tab === "orders" && <Orders orders={orders} tradingOpen={tradingOpen} onCancel={cancel} />}
          {tab === "history" && <History trades={trades} />}
          {tab === "pnl" && <Pnl account={account} />}
        </div>
      </div>
      {children}
    </section>
  );
}

function Positions({
  positions,
  tradingOpen,
  onSymbol,
  onClose,
}: {
  positions: Position[];
  tradingOpen: boolean;
  onSymbol: (t: string) => void;
  onClose: (ticker: string, side: Side, qty: number) => void;
}) {
  if (positions.length === 0) return <Empty>No open positions.</Empty>;
  return (
    <table className="w-full border-collapse" data-testid="positions-table">
      <thead>
        <tr>
          <th className={th}>Symbol</th>
          <th className={th}>Side</th>
          <th className={`${th} text-right`}>Qty</th>
          <th className={`${th} text-right`}>Avg price</th>
          <th className={`${th} text-right`}>Last</th>
          <th className={`${th} text-right`}>Market value</th>
          <th className={`${th} text-right`}>Unrealized P&L</th>
          <th className={th} aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.ticker} data-testid={`position-row-${p.ticker}`} className="border-b border-line/50 hover:bg-hover">
            <td className={`${td} cursor-pointer font-semibold text-strong`} onClick={() => onSymbol(p.ticker)}>
              {p.ticker}
            </td>
            <td className={`${td} ${p.side === "long" ? "text-up" : "text-down"} capitalize`}>{p.side}</td>
            <td className={`${td} num text-right`} data-testid={`position-qty-${p.ticker}`}>
              {fmtInt(p.qty)}
            </td>
            <td className={`${td} num text-right`}>{fmtPrice(p.avg_price)}</td>
            <td className={`${td} num text-right`}>{fmtPrice(p.last)}</td>
            <td className={`${td} num text-right`}>{fmtUsd(p.market_value)}</td>
            <td className={`${td} num text-right ${toneClass(p.unrealized_pnl)}`}>{fmtSignedUsd(p.unrealized_pnl)}</td>
            <td className={`${td} text-right`}>
              <button
                type="button"
                disabled={!tradingOpen}
                data-testid={`position-close-${p.ticker}`}
                onClick={() => onClose(p.ticker, p.qty > 0 ? "sell" : "cover", Math.abs(p.qty))}
                className="rounded px-2 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-text disabled:opacity-40"
              >
                Close…
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATUS_TONE: Record<Order["status"], string> = {
  working: "text-accent",
  filled: "text-up",
  cancelled: "text-muted",
  rejected: "text-down",
};

function Orders({
  orders,
  tradingOpen,
  onCancel,
}: {
  orders: Order[];
  tradingOpen: boolean;
  onCancel: (id: number) => void;
}) {
  if (orders.length === 0) return <Empty>No orders yet today.</Empty>;
  return (
    <table className="w-full border-collapse" data-testid="orders-table">
      <thead>
        <tr>
          <th className={th}>#</th>
          <th className={th}>Time</th>
          <th className={th}>Symbol</th>
          <th className={th}>Side</th>
          <th className={th}>Type</th>
          <th className={`${th} text-right`}>Qty</th>
          <th className={`${th} text-right`}>Limit / Stop</th>
          <th className={th}>Status</th>
          <th className={`${th} text-right`}>Fill</th>
          <th className={th}>Details</th>
          <th className={th} aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} data-testid={`order-row-${o.id}`} className="border-b border-line/50 hover:bg-hover">
            <td className={`${td} num text-faint`}>{o.id}</td>
            <td className={`${td} num text-muted`}>{simTime(o.created_sim_ts)}</td>
            <td className={`${td} font-semibold text-strong`}>{o.ticker}</td>
            <td className={`${td} capitalize ${o.side === "buy" || o.side === "cover" ? "text-up" : "text-down"}`}>{o.side}</td>
            <td className={`${td} capitalize`}>{o.type}</td>
            <td className={`${td} num text-right`}>{fmtInt(o.qty)}</td>
            <td className={`${td} num text-right`}>{fmtPrice(o.limit_price ?? o.stop_price)}</td>
            <td className={`${td} capitalize ${STATUS_TONE[o.status]}`} data-testid={`order-status-${o.id}`}>
              {o.status}
              {o.status === "working" && o.triggered_sim_ts != null ? " (triggered)" : ""}
            </td>
            <td className={`${td} num text-right`}>
              {o.fill_price != null ? `${fmtPrice(o.fill_price)} @ ${simTime(o.filled_sim_ts)}` : "—"}
            </td>
            <td className={`${td} max-w-72 truncate text-[11px] text-muted`} title={o.reason ?? ""}>
              {o.reason ?? ""}
            </td>
            <td className={`${td} text-right`}>
              {o.status === "working" && (
                <button
                  type="button"
                  disabled={!tradingOpen}
                  aria-label={`Cancel order ${o.id}`}
                  data-testid={`order-cancel-${o.id}`}
                  onClick={() => onCancel(o.id)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-down-soft hover:text-down disabled:opacity-40"
                >
                  <X size={12} /> Cancel
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function History({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return <Empty>No executions yet today.</Empty>;
  return (
    <table className="w-full border-collapse" data-testid="history-table">
      <thead>
        <tr>
          <th className={th}>Time</th>
          <th className={th}>Symbol</th>
          <th className={th}>Side</th>
          <th className={`${th} text-right`}>Qty</th>
          <th className={`${th} text-right`}>Price</th>
          <th className={`${th} text-right`}>Value</th>
          <th className={`${th} text-right`}>Realized P&L</th>
          <th className={`${th} text-right`}>Order #</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id} data-testid={`trade-row-${t.id}`} className="border-b border-line/50 hover:bg-hover">
            <td className={`${td} num text-muted`}>{t.time}</td>
            <td className={`${td} font-semibold text-strong`}>{t.ticker}</td>
            <td className={`${td} capitalize ${t.side === "buy" || t.side === "cover" ? "text-up" : "text-down"}`}>{t.side}</td>
            <td className={`${td} num text-right`}>{fmtInt(t.qty)}</td>
            <td className={`${td} num text-right`}>{fmtPrice(t.price)}</td>
            <td className={`${td} num text-right`}>{fmtUsd(t.qty * t.price)}</td>
            <td className={`${td} num text-right ${toneClass(t.realized_pnl)}`}>
              {t.side === "sell" || t.side === "cover" ? fmtSignedUsd(t.realized_pnl) : "—"}
            </td>
            <td className={`${td} num text-right text-faint`}>{t.order_id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Pnl({ account }: { account: Account | null }) {
  if (!account) return <Empty>Loading account…</Empty>;
  const cells: [string, number, boolean][] = [
    ["Equity", account.equity, false],
    ["Cash", account.cash, false],
    ["Buying power", account.buying_power, false],
    ["Long market value", account.long_market_value, false],
    ["Short collateral", account.short_collateral, false],
    ["Reserved for orders", account.reserved_for_orders, false],
    ["Realized P&L", account.realized_pnl, true],
    ["Unrealized P&L", account.unrealized_pnl, true],
    ["Total P&L", account.total_pnl, true],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 p-3 xl:grid-cols-5" data-testid="pnl-summary">
      {cells.map(([label, value, signed]) => (
        <div key={label} className="rounded border border-line bg-bg px-3 py-2">
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">{label}</div>
          <div
            className={`num mt-0.5 text-[14px] ${signed ? toneClass(value) : "text-strong"}`}
            data-testid={`pnl-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
          >
            {signed ? fmtSignedUsd(value) : fmtUsd(value)}
          </div>
        </div>
      ))}
      <p className="col-span-full text-[11px] text-faint">
        Starting cash {fmtUsd(account.start_cash)}. Shorts are cash-secured: 100% of the entry value is held as
        collateral until covered. No margin.
      </p>
    </div>
  );
}
