import { BellRing, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { CONDITION_LABEL, fmtPrice } from "../format";
import type { Alert, AlertCondition, AlertLogEntry, SymbolInfo } from "../types";
import { Button, Empty, ErrorText, Field, IconButton, Input, Select } from "./ui";

const CONDITIONS: AlertCondition[] = ["above", "below", "crossing_up", "crossing_down"];

type Draft = { ticker: string; condition: AlertCondition; price: string; note: string };

export function Alerts({
  alerts,
  log,
  symbols,
  active,
  closed,
  prefill,
  reload,
}: {
  alerts: Alert[];
  log: AlertLogEntry[];
  symbols: SymbolInfo[];
  active: string;
  closed: boolean;
  prefill: { ticker: string; price: number; nonce: number } | null;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>({ ticker: active, condition: "crossing_up", price: "", note: "" });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editing == null) setDraft((d) => ({ ...d, ticker: active }));
  }, [active, editing]);

  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setError("");
    setDraft((d) => ({ ...d, ticker: prefill.ticker, price: prefill.price ? prefill.price.toFixed(2) : "" }));
  }, [prefill]);

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

  const save = async () => {
    const ticker = draft.ticker.trim().toUpperCase();
    const price = Number(draft.price);
    if (!symbols.some((s) => s.ticker === ticker)) return setError(`Unknown symbol "${ticker}".`);
    if (!draft.price || !Number.isFinite(price) || price <= 0) return setError("Enter a price above 0.");
    if (Math.abs(Math.round(price * 100) - price * 100) > 1e-6)
      return setError("Prices can have at most 2 decimal places.");
    const ok =
      editing == null
        ? await run(() => api.createAlert({ ticker, condition: draft.condition, price, note: draft.note }))
        : await run(() => api.updateAlert(editing, { condition: draft.condition, price, note: draft.note }));
    if (ok) {
      setEditing(null);
      setDraft({ ticker: active, condition: draft.condition, price: "", note: "" });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="alerts">
      <form
        noValidate
        className="flex flex-col gap-2 border-b border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-testid="alert-form"
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Symbol">
            <Input
              data-testid="alert-ticker"
              list="cv-symbols"
              disabled={editing != null}
              value={draft.ticker}
              onChange={(e) => setDraft({ ...draft, ticker: e.target.value })}
              className="uppercase"
            />
          </Field>
          <Field label="Condition">
            <Select
              data-testid="alert-condition"
              value={draft.condition}
              onChange={(e) => setDraft({ ...draft, condition: e.target.value as AlertCondition })}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price">
            <Input
              data-testid="alert-price"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </Field>
          <Field label="Note (optional)">
            <Input
              data-testid="alert-note"
              maxLength={200}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex gap-1.5">
          <Button type="submit" variant="primary" data-testid="alert-save" disabled={closed} className="flex-1">
            <BellRing size={13} /> {editing == null ? "Create alert" : "Save changes"}
          </Button>
          {editing != null && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setDraft({ ticker: active, condition: "crossing_up", price: "", note: "" });
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        <ErrorText testId="alert-error">{error}</ErrorText>
      </form>

      <div className="min-h-0 flex-1 overflow-auto">
        <SectionTitle>Alerts</SectionTitle>
        {alerts.length === 0 ? (
          <Empty>No alerts yet.</Empty>
        ) : (
          <ul data-testid="alert-list">
            {alerts.map((a) => (
              <li
                key={a.id}
                data-testid={`alert-row-${a.id}`}
                className="flex items-center gap-2 border-b border-line/50 px-2 py-1.5 hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-strong">{a.ticker}</span>
                    <span className="text-muted">{CONDITION_LABEL[a.condition]}</span>
                    <span className="num text-strong">{fmtPrice(a.price)}</span>
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    <StatusBadge alert={a} />
                    {a.note && <span className="truncate text-muted">{a.note}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={a.enabled}
                  data-testid={`alert-toggle-${a.id}`}
                  disabled={closed}
                  onClick={() => run(() => api.updateAlert(a.id, { enabled: !a.enabled }))}
                  className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-text disabled:opacity-40"
                >
                  {a.enabled ? "Disable" : "Enable"}
                </button>
                <IconButton
                  label="Edit alert"
                  data-testid={`alert-edit-${a.id}`}
                  onClick={() => {
                    setEditing(a.id);
                    setDraft({ ticker: a.ticker, condition: a.condition, price: String(a.price), note: a.note });
                  }}
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  label="Delete alert"
                  data-testid={`alert-delete-${a.id}`}
                  onClick={() => run(() => api.deleteAlert(a.id))}
                >
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <SectionTitle>Alert log</SectionTitle>
        {log.length === 0 ? (
          <Empty>No alerts have fired.</Empty>
        ) : (
          <ul data-testid="alert-log">
            {log.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 border-b border-line/50 px-2 py-1 text-[12px]">
                <span className="num text-muted">{e.time}</span>
                <span className="font-semibold text-strong">{e.ticker}</span>
                <span className="text-muted">{CONDITION_LABEL[e.condition]}</span>
                <span className="num">{fmtPrice(e.price)}</span>
                <span className="ml-auto num text-faint">@ {fmtPrice(e.trigger_price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ alert }: { alert: Alert }) {
  if (alert.status === "triggered")
    return <span className="text-warn">Triggered {alert.triggered_time}</span>;
  if (alert.status === "disabled") return <span className="text-faint">Disabled</span>;
  return <span className="text-up">Active</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 bg-panel px-2 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">
      {children}
    </div>
  );
}
