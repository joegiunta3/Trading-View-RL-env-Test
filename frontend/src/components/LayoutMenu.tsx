import { useEffect, useRef, useState } from "react";
import type { LayoutId } from "../types";

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "1", label: "1 chart" },
  { id: "2", label: "2 charts side by side" },
  { id: "3", label: "3 charts in columns" },
  { id: "4", label: "4 charts in a grid" },
];

/** Outline icon of a layout: a rounded frame with dividers. */
export function LayoutIcon({ id, size = 18 }: { id: LayoutId; size?: number }) {
  const w = size;
  const h = Math.round(size * 0.78);
  const lines: [number, number, number, number][] = [];
  if (id === "2" || id === "4") lines.push([w / 2, 1, w / 2, h - 1]);
  if (id === "3") lines.push([w / 3, 1, w / 3, h - 1], [(2 * w) / 3, 1, (2 * w) / 3, h - 1]);
  if (id === "4") lines.push([1, h / 2, w - 1, h / 2]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="0.7" y="0.7" width={w - 1.4} height={h - 1.4} rx="2.5" />
      {lines.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </svg>
  );
}

/** Toolbar button that opens the layout picker (1, 2, 3 or 4 charts). */
export function LayoutMenu({ layout, onChange }: { layout: LayoutId; onChange: (l: LayoutId) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title="Layout setup"
        aria-label="Layout setup"
        aria-expanded={open}
        data-testid="layout-button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${
          open ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
        }`}
      >
        <LayoutIcon id={layout} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Chart layouts"
          data-testid="layout-menu"
          className="absolute top-8 right-0 z-50 w-60 rounded border border-line-strong bg-raised py-1 shadow-2xl"
        >
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === layout}
              data-testid={`layout-option-${l.id}`}
              onClick={() => {
                onChange(l.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[12px] hover:bg-hover ${
                l.id === layout ? "text-accent" : "text-text"
              }`}
            >
              <span className="w-3 text-muted">{l.id}</span>
              <LayoutIcon id={l.id} size={22} />
              <span className="whitespace-nowrap text-muted">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
