import type { Clock } from "../types";

export type RangePreset = { id: string; label: string; tf: string; sessions?: number; fromDate?: string; title: string };

export function rangePresets(sessionDate: string): RangePreset[] {
  return [
    { id: "1D", label: "1D", tf: "5m", sessions: 1, title: "Today on 5-minute bars" },
    { id: "5D", label: "5D", tf: "15m", sessions: 5, title: "Last 5 sessions on 15-minute bars" },
    { id: "1M", label: "1M", tf: "1h", sessions: 21, title: "Last month on hourly bars" },
    { id: "YTD", label: "YTD", tf: "1h", fromDate: `${sessionDate.slice(0, 4)}-01-01`, title: "Year to date on hourly bars" },
    { id: "3M", label: "3M", tf: "1D", sessions: 61, title: "All history on daily bars" },
  ];
}

/** Bar under the chart: quick date ranges on the left, sim clock on the right. */
export function RangeBar({
  presets,
  onRange,
  clock,
}: {
  presets: RangePreset[];
  onRange: (p: RangePreset) => void;
  clock: Clock | null;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-panel px-2" data-testid="range-bar">
      <div className="flex items-center gap-0.5" role="group" aria-label="Date range">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.title}
            data-testid={`range-${p.id}`}
            onClick={() => onRange(p)}
            className="h-6 rounded px-2 text-[12px] font-medium text-muted hover:bg-hover hover:text-text"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="num text-text" data-testid="range-clock">
          {clock ? `Day ${clock.day} · ${clock.time}` : "--:--:--"}
        </span>
        <span>sim time</span>
      </div>
    </div>
  );
}
