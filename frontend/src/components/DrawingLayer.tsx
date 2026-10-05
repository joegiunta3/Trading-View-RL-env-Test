import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { fmtInt, fmtPct, fmtPrice, fmtSigned } from "../format";
import { theme } from "../theme";
import type { Bar, Drawing, DrawingKind, DrawingPoint } from "../types";

/** Where the plot is on screen and how to map between data and pixels (from ChartPanel). */
export type Geometry = {
  rect: { x: number; y: number; width: number; height: number };
  start: number; // visible window, in bar indices (may extend into the empty future area)
  end: number;
  bars: Bar[];
  tfSeconds: number;
  futureSlots: number;
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
};

export const POINTS: Record<DrawingKind, number> = {
  info_line: 2,
  trendline: 2,
  horizontal_line: 1,
  vertical_line: 1,
};

type Drag = { id: number; mode: number | "move"; startIdx: number; startPrice: number; orig: DrawingPoint[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fractional bar index for a time (bars are sorted by time; future times extrapolate). */
function indexOfTime(g: Geometry, t: number): number {
  const b = g.bars;
  if (b.length === 0) return 0;
  if (t <= b[0].time) return (t - b[0].time) / g.tfSeconds;
  const last = b.length - 1;
  if (t >= b[last].time) return last + (t - b[last].time) / g.tfSeconds;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (b[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo + Math.min(0.999, (t - b[lo].time) / Math.max(1, b[lo + 1].time - b[lo].time));
}

function timeOfIndex(g: Geometry, k: number): number {
  const b = g.bars;
  const last = b.length - 1;
  if (k <= 0) return b[0]?.time ?? 0;
  if (k <= last) return b[k].time;
  return b[last].time + (k - last) * g.tfSeconds;
}

const band = (g: Geometry) => g.rect.width / Math.max(1, g.end - g.start + 1);
const xOf = (g: Geometry, idx: number) => g.rect.x + (idx - g.start + 0.5) * band(g);

function fmtDuration(seconds: number, daily: boolean): string {
  const s = Math.abs(seconds);
  if (daily) return `${Math.round(s / 86400)}d`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** The three lines of an info line's label, from its two points. */
export function infoText(g: Geometry, a: DrawingPoint, b: DrawingPoint, daily: boolean): string[] {
  const ca = Math.round(a.price * 100);
  const cb = Math.round(b.price * 100);
  const diff = cb - ca;
  const ia = indexOfTime(g, a.time);
  const ib = indexOfTime(g, b.time);
  const bars = Math.round(ib) - Math.round(ia);
  const dx = xOf(g, ib) - xOf(g, ia);
  const dy = g.priceToY(b.price) - g.priceToY(a.price);
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return [
    `${fmtSigned(diff / 100)} (${fmtPct((diff / ca) * 100)}), ${diff > 0 ? "+" : ""}${fmtInt(diff)}`,
    `${bars} bars (${fmtDuration(bars * g.tfSeconds, daily)}), distance: ${Math.round(Math.hypot(dx, dy))} px`,
    `${angle.toFixed(2)}°`,
  ];
}

type Props = {
  geom: Geometry | null;
  drawings: Drawing[];
  tool: DrawingKind | null;
  magnet: boolean;
  daily: boolean;
  selectedId: number | null;
  onCreate: (kind: DrawingKind, points: DrawingPoint[]) => void;
  onMove: (id: number, points: DrawingPoint[]) => void;
  onSelect: (id: number | null) => void;
  onDelete: (id: number) => void;
};

export function DrawingLayer(p: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<{ a: DrawingPoint; b: DrawingPoint | null } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [overrides, setOverrides] = useState<Record<number, DrawingPoint[]>>({});
  const g = p.geom;

  useEffect(() => setPending(null), [p.tool]);
  useEffect(() => setOverrides({}), [p.drawings]);

  if (!g || g.bars.length === 0) return null;
  const n = g.bars.length;

  /** Data point under the pointer (bar-aligned; magnet snaps to the bar's nearest O/H/L/C). */
  const pick = (e: ReactPointerEvent | PointerEvent, snap: boolean): DrawingPoint & { k: number } => {
    const box = svg.current!.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const idx = (x - g.rect.x) / band(g) - 0.5 + g.start;
    const k = Math.max(0, Math.min(n - 1 + g.futureSlots, Math.round(idx)));
    let price = g.yToPrice(y);
    if (snap && k < n) {
      const bar = g.bars[k];
      price = [bar.o, bar.h, bar.l, bar.c].reduce((best, v) => (Math.abs(v - price) < Math.abs(best - price) ? v : best));
    }
    return { time: timeOfIndex(g, k), price: Math.max(0.01, round2(price)), k };
  };

  // --- creating ------------------------------------------------------------------------------
  const onToolDown = (e: ReactPointerEvent) => {
    if (!p.tool || e.button !== 0) return;
    e.stopPropagation();
    const pt = pick(e, p.magnet);
    const point = { time: pt.time, price: pt.price };
    if (POINTS[p.tool] === 1) {
      p.onCreate(p.tool, [point]);
    } else if (!pending) {
      setPending({ a: point, b: point });
    } else {
      p.onCreate(p.tool, [pending.a, point]);
      setPending(null);
    }
  };
  const onToolMove = (e: ReactPointerEvent) => {
    if (pending) {
      const pt = pick(e, p.magnet);
      setPending({ a: pending.a, b: { time: pt.time, price: pt.price } });
    }
  };

  // --- editing -------------------------------------------------------------------------------
  const startDrag = (e: ReactPointerEvent, d: Drawing, mode: number | "move") => {
    if (p.tool || e.button !== 0) return;
    e.stopPropagation();
    p.onSelect(d.id);
    const pt = pick(e, false);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: d.id, mode, startIdx: pt.k, startPrice: g.yToPrice(e.clientY - svg.current!.getBoundingClientRect().top), orig: d.points });
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    let pts: DrawingPoint[];
    if (drag.mode === "move") {
      const pt = pick(e, false);
      const dk = pt.k - drag.startIdx;
      const dp = g.yToPrice(e.clientY - svg.current!.getBoundingClientRect().top) - drag.startPrice;
      pts = drag.orig.map((o) => ({
        time: timeOfIndex(g, Math.round(indexOfTime(g, o.time)) + dk),
        price: Math.max(0.01, round2(o.price + dp)),
      }));
    } else {
      const pt = pick(e, p.magnet);
      pts = drag.orig.map((o, i) => (i === drag.mode ? { time: pt.time, price: pt.price } : o));
    }
    setOverrides((ov) => ({ ...ov, [drag.id]: pts }));
  };
  const endDrag = () => {
    if (!drag) return;
    const pts = overrides[drag.id];
    if (pts && JSON.stringify(pts) !== JSON.stringify(drag.orig.map(({ time, price }) => ({ time, price })))) {
      p.onMove(drag.id, pts);
    }
    setDrag(null);
  };

  const { rect } = g;
  const items = p.drawings.map((d) => ({ d, pts: overrides[d.id] ?? d.points }));
  const preview =
    pending && pending.b && p.tool
      ? { d: { id: -1, kind: p.tool } as Drawing, pts: [pending.a, pending.b] }
      : null;

  return (
    <svg
      ref={svg}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: "none" }}
      onPointerMove={(e) => (drag ? onDragMove(e) : onToolMove(e))}
      onPointerUp={endDrag}
      data-testid="drawing-layer"
    >
      <defs>
        <clipPath id={`plot-${rect.x}-${rect.width}`}>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
        </clipPath>
      </defs>
      {p.tool && (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="transparent"
          style={{ pointerEvents: "all", cursor: "crosshair" }}
          onPointerDown={onToolDown}
          data-testid="drawing-capture"
        />
      )}
      <g clipPath={`url(#plot-${rect.x}-${rect.width})`}>
        {items.map(({ d, pts }) => (
          <Shape key={d.id} g={g} d={d} pts={pts} selected={p.selectedId === d.id} daily={p.daily} onDown={startDrag} />
        ))}
        {preview && <Shape g={g} d={preview.d} pts={preview.pts} selected={false} daily={p.daily} onDown={() => {}} />}
      </g>
      {items
        .filter(({ d }) => d.id === p.selectedId && !p.tool)
        .map(({ d, pts }) => (
          <g key={`h${d.id}`}>
            {pts.map((pt, i) => {
              const x = d.kind === "horizontal_line" ? rect.x + rect.width - 90 : xOf(g, indexOfTime(g, pt.time));
              const y = d.kind === "vertical_line" ? rect.y + 30 : g.priceToY(pt.price);
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={5}
                  fill={theme.bg}
                  stroke={theme.accent}
                  strokeWidth={2}
                  style={{ pointerEvents: "all", cursor: "move" }}
                  onPointerDown={(e) => startDrag(e, d, i)}
                  data-testid={`drawing-handle-${d.id}-${i}`}
                />
              );
            })}
            <DeleteChip
              x={d.kind === "horizontal_line" ? rect.x + rect.width - 70 : xOf(g, indexOfTime(g, pts[pts.length - 1].time)) + 14}
              y={d.kind === "vertical_line" ? rect.y + 30 : g.priceToY(pts[pts.length - 1].price) - 14}
              onClick={() => p.onDelete(d.id)}
              testId={`drawing-delete-${d.id}`}
            />
          </g>
        ))}
    </svg>
  );
}

function Shape({
  g,
  d,
  pts,
  selected,
  daily,
  onDown,
}: {
  g: Geometry;
  d: Drawing;
  pts: DrawingPoint[];
  selected: boolean;
  daily: boolean;
  onDown: (e: ReactPointerEvent, d: Drawing, mode: "move") => void;
}) {
  const { rect } = g;
  const color = theme.accent;
  const width = selected ? 2 : 1.5;
  const hit = (x1: number, y1: number, x2: number, y2: number) => (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="transparent"
      strokeWidth={12}
      style={{ pointerEvents: d.id > 0 ? "stroke" : "none", cursor: "pointer" }}
      onPointerDown={(e) => onDown(e, d, "move")}
      data-testid={d.id > 0 ? `drawing-${d.id}` : undefined}
    />
  );

  if (d.kind === "horizontal_line") {
    const y = g.priceToY(pts[0].price);
    return (
      <g data-kind={d.kind}>
        <line x1={rect.x} y1={y} x2={rect.x + rect.width} y2={y} stroke={color} strokeWidth={width} />
        {hit(rect.x, y, rect.x + rect.width, y)}
        <g transform={`translate(${rect.x + rect.width - 58},${y - 9})`}>
          <rect width={56} height={18} rx={2} fill={color} />
          <text x={28} y={13} textAnchor="middle" fontSize={11} fill={theme.textStrong} className="num">
            {fmtPrice(pts[0].price)}
          </text>
        </g>
      </g>
    );
  }
  if (d.kind === "vertical_line") {
    const x = xOf(g, indexOfTime(g, pts[0].time));
    return (
      <g data-kind={d.kind}>
        <line x1={x} y1={rect.y} x2={x} y2={rect.y + rect.height} stroke={color} strokeWidth={width} />
        {hit(x, rect.y, x, rect.y + rect.height)}
      </g>
    );
  }
  const x1 = xOf(g, indexOfTime(g, pts[0].time));
  const y1 = g.priceToY(pts[0].price);
  const x2 = xOf(g, indexOfTime(g, pts[1].time));
  const y2 = g.priceToY(pts[1].price);
  return (
    <g data-kind={d.kind}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />
      {hit(x1, y1, x2, y2)}
      {d.kind === "info_line" && <InfoLabel g={g} x={x2} y={y2} lines={infoText(g, pts[0], pts[1], daily)} id={d.id} />}
    </g>
  );
}

function InfoLabel({ g, x, y, lines, id }: { g: Geometry; x: number; y: number; lines: string[]; id: number }) {
  const w = Math.max(...lines.map((l) => l.length)) * 7.5 + 22; // monospace 12px is ~7.2px per char
  const h = lines.length * 18 + 10;
  const { rect } = g;
  const left = Math.min(Math.max(rect.x + 4, x + 12), rect.x + rect.width - w - 4);
  const top = Math.min(Math.max(rect.y + 4, y + 12), rect.y + rect.height - h - 4);
  return (
    <g transform={`translate(${left},${top})`} data-testid={id > 0 ? `drawing-info-${id}` : "drawing-info-preview"}>
      <rect width={w} height={h} rx={4} fill={theme.panelRaised} stroke={theme.borderStrong} opacity={0.96} />
      {lines.map((l, i) => (
        <text key={i} x={10} y={22 + i * 18} fontSize={12} fill={theme.textStrong} className="num">
          {l}
        </text>
      ))}
    </g>
  );
}

function DeleteChip({ x, y, onClick, testId }: { x: number; y: number; onClick: () => void; testId: string }) {
  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ pointerEvents: "all", cursor: "pointer" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick();
      }}
      data-testid={testId}
      role="button"
      aria-label="Delete drawing"
    >
      <circle r={8} fill={theme.panelRaised} stroke={theme.down} />
      <path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke={theme.down} strokeWidth={1.6} />
    </g>
  );
}
