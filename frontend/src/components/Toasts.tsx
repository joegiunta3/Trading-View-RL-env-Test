import { BellRing, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type Toast = { id: number; tone: "info" | "success" | "error" | "alert"; title: string; body?: string };

const ICON = { info: Info, success: CheckCircle2, error: XCircle, alert: BellRing };
const TONE = { info: "text-accent", success: "text-up", error: "text-down", alert: "text-warn" };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-[100] flex w-96 -translate-x-1/2 flex-col gap-2" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            data-testid={`toast-${t.tone}`}
            className="pointer-events-auto flex gap-2.5 rounded-md border border-line-strong bg-raised p-3 shadow-2xl"
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${TONE[t.tone]}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-strong">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[12px] text-muted">{t.body}</div>}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(t.id)}
              className="self-start rounded p-0.5 text-faint hover:text-text"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
