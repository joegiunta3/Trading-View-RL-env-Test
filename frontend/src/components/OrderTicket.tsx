import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { fmtInt, fmtPrice, fmtUsd } from "../format";
import type { Order, OrderType, Quote, Side, SymbolInfo } from "../types";
import { Button, ErrorText, Field, Input, Select } from "./ui";

export type TicketPrefill = { ticker: string; side: Side; qty?: number; nonce: number };

const SIDES: { id: Side; label: string; tone: "up" | "down" }[] = [
  { id: "buy", label: "Buy", tone: "up" },
  { id: "sell", label: "Sell", tone: "down" },
  { id: "short", label: "Short", tone: "down" },
  { id: "cover", label: "Cover", tone: "up" },
];

type Draft = { ticker: string; side: Side; type: OrderType; qty: string; limit: string; stop: string };

function priceOk(s: string): number | null {
  const n = Number(s);
  if (!s.trim() || !Number.isFinite(n) || n <= 0) return null;
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return null;
  return n;
}

export function OrderTicket({
  active,
  quotes,
  symbols,
  tradingOpen,
  prefill,
  onPlaced,
}: {
  active: string;
  quotes: Record<string, Quote>;
  symbols: SymbolInfo[];
  tradingOpen: boolean;
  prefill: TicketPrefill | null;
  onPlaced: () => void;
}) {
  const [d, setD] = useState<Draft>({ ticker: active, side: "buy", type: "market", qty: "", limit: "", stop: "" });
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step === "edit") setD((x) => ({ ...x, ticker: active }));
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!prefill) return;
    setD((x) => ({ ...x, ticker: prefill.ticker, side: prefill.side, qty: prefill.qty ? String(prefill.qty) : x.qty }));
    setStep("edit");
    setError("");
  }, [prefill]);

  const ticker = d.ticker.trim().toUpperCase();
  const q = quotes[ticker];
  const paysAsk = d.side === "buy" || d.side === "cover";
  const refPrice =
    d.type === "limit" ? priceOk(d.limit) : d.type === "stop" ? priceOk(d.stop) : q ? (paysAsk ? q.ask : q.bid) : null;
  const qtyNum = Number(d.qty);
  const estimate = refPrice != null && Number.isInteger(qtyNum) && qtyNum > 0 ? refPrice * qtyNum : null;

  const review = () => {
    setResult(null);
    if (!symbols.some((s) => s.ticker === ticker)) return setError(`Unknown symbol "${ticker}".`);
    if (!/^\d+$/.test(d.qty.trim()) || qtyNum <= 0) return setError("Quantity must be a positive whole number.");
    if (d.type === "limit" && priceOk(d.limit) == null) return setError("Enter a limit price above 0 (max 2 decimals).");
    if (d.type === "stop" && priceOk(d.stop) == null) return setError("Enter a stop price above 0 (max 2 decimals).");
    setError("");
    setStep("confirm");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const order = await api.placeOrder({
        ticker,
        side: d.side,
        type: d.type,
        qty: qtyNum,
        limit_price: d.type === "limit" ? priceOk(d.limit) : null,
        stop_price: d.type === "stop" ? priceOk(d.stop) : null,
      });
      setResult(order);
      setStep("edit");
      if (order.status !== "rejected") setD((x) => ({ ...x, qty: "" }));
      onPlaced();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Order could not be sent.");
      setStep("edit");
    } finally {
      setBusy(false);
    }
  };

  const sideInfo = SIDES.find((s) => s.id === d.side)!;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-panel" aria-label="Order ticket" data-testid="order-ticket">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold text-strong">Order ticket</span>
        <span className="text-[11px] text-faint">Day order</span>
      </div>
      {step === "edit" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Side">
            {SIDES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={d.side === s.id}
                data-testid={`ticket-side-${s.id}`}
                onClick={() => setD({ ...d, side: s.id })}
                className={`h-7 rounded text-[12px] font-semibold transition-colors ${
                  d.side === s.id
                    ? s.tone === "up"
                      ? "bg-up text-strong"
                      : "bg-down text-strong"
                    : "bg-raised text-muted hover:text-text"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Symbol">
              <Input
                data-testid="ticket-symbol"
                list="cv-symbols"
                value={d.ticker}
                onChange={(e) => setD({ ...d, ticker: e.target.value })}
                className="font-semibold uppercase"
              />
            </Field>
            <Field label="Quantity">
              <Input
                data-testid="ticket-qty"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={d.qty}
                onChange={(e) => setD({ ...d, qty: e.target.value })}
              />
            </Field>
            <Field label="Type">
              <Select
                data-testid="ticket-type"
                value={d.type}
                onChange={(e) => setD({ ...d, type: e.target.value as OrderType })}
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
              </Select>
            </Field>
            {d.type === "market" ? (
              <Field label="Price">
                <Input disabled value="At market" aria-label="Price" />
              </Field>
            ) : d.type === "limit" ? (
              <Field label="Limit price">
                <Input
                  data-testid="ticket-limit"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={d.limit}
                  onChange={(e) => setD({ ...d, limit: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="Stop price">
                <Input
                  data-testid="ticket-stop"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={d.stop}
                  onChange={(e) => setD({ ...d, stop: e.target.value })}
                />
              </Field>
            )}
          </div>
          <div className="flex justify-between rounded bg-bg px-2 py-1.5 text-[11px]">
            <span className="text-muted">
              Bid <span className="num text-down">{fmtPrice(q?.bid)}</span>
            </span>
            <span className="text-muted">
              Ask <span className="num text-up">{fmtPrice(q?.ask)}</span>
            </span>
            <span className="text-muted">
              Est. <span className="num text-text">{fmtUsd(estimate)}</span>
            </span>
          </div>
          <ErrorText testId="ticket-error">{error}</ErrorText>
          <Button
            variant={sideInfo.tone}
            data-testid="ticket-review"
            disabled={!tradingOpen}
            onClick={review}
            className="h-8"
          >
            {tradingOpen ? `Review ${sideInfo.label.toLowerCase()} order` : "Market closed"}
          </Button>
          {result && <ResultLine order={result} />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3" data-testid="ticket-confirm">
          <div className="text-[11px] text-muted">Please confirm this order</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-line bg-bg px-2.5 py-1.5 text-[12px]">
            <dt className="text-muted">Action</dt>
            <dd className={`font-semibold ${sideInfo.tone === "up" ? "text-up" : "text-down"}`} data-testid="confirm-side">
              {sideInfo.label}
            </dd>
            <dt className="text-muted">Symbol</dt>
            <dd className="font-semibold text-strong" data-testid="confirm-symbol">
              {ticker}
            </dd>
            <dt className="text-muted">Quantity</dt>
            <dd className="num" data-testid="confirm-qty">
              {fmtInt(qtyNum)}
            </dd>
            <dt className="text-muted">Type</dt>
            <dd className="capitalize" data-testid="confirm-type">
              {d.type}
              {d.type !== "market" && <span className="num normal-case"> @ {fmtPrice(refPrice)}</span>} · Day
            </dd>
            <dt className="text-muted">Estimated value</dt>
            <dd className="num">{fmtUsd(estimate)}</dd>
          </dl>
          <div className="mt-auto flex shrink-0 gap-2">
            <Button variant="ghost" data-testid="ticket-back" onClick={() => setStep("edit")} className="flex-1">
              <ArrowLeft size={13} /> Back
            </Button>
            <Button
              variant={sideInfo.tone}
              data-testid="ticket-submit"
              disabled={busy || !tradingOpen}
              onClick={submit}
              className="flex-1"
            >
              <Send size={13} /> Submit
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function ResultLine({ order }: { order: Order }) {
  const what = `${order.side.toUpperCase()} ${fmtInt(order.qty)} ${order.ticker}`;
  if (order.status === "rejected")
    return (
      <p role="alert" data-testid="ticket-result" data-status="rejected" className="rounded bg-down-soft px-2 py-1.5 text-[11px] text-down">
        Rejected: {order.reason}
      </p>
    );
  return (
    <p
      role="status"
      data-testid="ticket-result"
      data-status={order.status}
      className="rounded bg-accent-soft px-2 py-1.5 text-[11px] text-text"
    >
      {order.status === "filled" ? `Filled: ${what} @ ${fmtPrice(order.fill_price)}` : `Working: ${what} (order #${order.id})`}
    </p>
  );
}
