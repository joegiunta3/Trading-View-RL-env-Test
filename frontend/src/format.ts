const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtPrice = (n: number | null | undefined): string => (n == null ? "—" : money.format(n));
export const fmtUsd = (n: number | null | undefined): string =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${money.format(Math.abs(n))}`;
export const fmtSignedUsd = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${money.format(Math.abs(n))}`;
export const fmtSigned = (n: number): string => `${n > 0 ? "+" : ""}${money.format(n)}`;
export const fmtPct = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const fmtInt = (n: number | null | undefined): string => (n == null ? "—" : integer.format(n));

/** m:ss for a countdown in real seconds. */
export const fmtCountdown = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Label and status-dot class for the market state shown in the UI. */
export function marketStatus(clock: { market_status: string; next_open_in?: number } | null): {
  label: string;
  dot: string;
} {
  switch (clock?.market_status) {
    case "open":
      return { label: "Market open", dot: "bg-up" };
    case "after-hours":
      return {
        label: `After hours · opens in ${fmtCountdown(clock.next_open_in ?? 0)}`,
        dot: "bg-warn",
      };
    case "closed":
      return { label: "Session closed", dot: "bg-down" };
    default:
      return { label: "Pre-open", dot: "bg-warn" };
  }
}

export const toneClass = (n: number): string => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");

export const CONDITION_LABEL: Record<string, string> = {
  above: "Above",
  below: "Below",
  crossing_up: "Crossing up",
  crossing_down: "Crossing down",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01-14" -> "Jan 14" (string arithmetic only; never reads a clock). */
export function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "2026-01-14" -> "Jan" */
export const fmtMonth = (iso: string): string => MONTHS[Number(iso.split("-")[1]) - 1];

/** Legend text for a bar: "Jan 14 10:05" for intraday, "Jan 14, 2026" for daily bars. */
export function fmtBarTime(b: { date: string; label: string }, daily: boolean): string {
  return daily ? `${fmtDay(b.date)}, ${b.date.slice(0, 4)}` : `${fmtDay(b.date)} ${b.label}`;
}
