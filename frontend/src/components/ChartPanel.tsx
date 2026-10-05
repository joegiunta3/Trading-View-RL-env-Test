import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, Minus, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { fmtBarTime, fmtDay, fmtInt, fmtMonth, fmtPct, fmtPrice, fmtSigned, toneClass } from "../format";
import {
  LOWER_PANE,
  type Series,
  catalogEntry,
  compute,
  indicatorKey,
  indicatorLabel,
  paramsText,
  shortName,
  validate,
} from "../indicators";
import { indicatorColors, smaColors, theme } from "../theme";
import type { Bar, Drawing, DrawingKind, DrawingPoint, Indicator, Quote } from "../types";
import { DrawingLayer, type Geometry } from "./DrawingLayer";

echarts.use([
  CandlestickChart,
  BarChart,
  LineChart,
  GridComponent,
  DataZoomComponent,
  TooltipComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type ChartControls = {
  zoomIn: () => void;
  zoomOut: () => void;
  panLeft: () => void;
  panRight: () => void;
  reset: () => void;
};

/** Ask the chart to show a range once bars for (ticker, tf) are loaded. */
export type RangeRequest = { ticker: string; tf: string; sessions?: number; fromDate?: string; nonce: number };

type Window = { start: number; end: number };
/** One plotted line of an indicator, with the legend test id and label for its value. */
type Line = { id: string; label: string; values: Series; color: string; dashed?: boolean };
type Study = { key: string; label: string; ind: Indicator; lines: Line[]; histogram?: Series; hidden: boolean };

const VISIBLE_BARS = 150;
const FUTURE_SLOTS = 60; // empty categories right of the last bar, for drawing into the future
const RIGHT_PAD = 8; // empty bars shown right of the last bar by default
const TF_SECONDS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1D": 86400 };
const GRID = { left: 10, right: 72, top: 16, bottom: 28 };
const SUB_GAP = 8; // space above each lower pane (for its legend)
const MIN_SPAN = 10;
const LABEL_PX = 84; // target spacing between time-axis labels
// Compact legend (no company name, no Sell/Buy boxes) in narrow or short panes.
const NARROW_PX = 560;
const SHORT_PX = 380;

type Props = {
  ticker: string;
  name: string;
  timeframe: string;
  indicators: Indicator[];
  bars: Bar[];
  /** "TICKER|tf" of the series in `bars` (they may lag the selected timeframe briefly). */
  barsKey: string;
  quote: Quote | undefined;
  closed: boolean;
  /** Message over the chart (after-hours break, end of episode), or null. */
  overlay: { title: string; body: string } | null;
  crosshair: boolean;
  controls: MutableRefObject<ChartControls | null>;
  range: RangeRequest | null;
  onQuickTrade: (side: "buy" | "sell") => void;
  drawings: Drawing[];
  tool: DrawingKind | null;
  magnet: boolean;
  selectedDrawing: number | null;
  onCreateDrawing: (kind: DrawingKind, points: DrawingPoint[]) => void;
  onMoveDrawing: (id: number, points: DrawingPoint[]) => void;
  onSelectDrawing: (id: number | null) => void;
  onDeleteDrawing: (id: number) => void;
  /** Replace this pane's indicator list (hide/show, edit settings, remove). */
  onIndicators: (next: Indicator[]) => void;
};

/** Price overlays and lower-pane studies for the given indicator configs. */
function buildStudies(bars: Bar[], indicators: Indicator[]): { overlays: Study[]; lowers: Study[] } {
  const overlays: Study[] = [];
  const lowers: Study[] = [];
  let color = 0;
  for (const ind of indicators) {
    if (ind.type === "volume") continue;
    const key = indicatorKey(ind);
    const label = indicatorLabel(ind);
    const hidden = !!ind.hidden;
    const out = compute(bars, ind);
    if (!LOWER_PANE.has(ind.type)) {
      const c = smaColors[color++ % smaColors.length];
      const lines: Line[] =
        ind.type === "bb"
          ? [
              { id: `${key}-upper`, label: "U", values: out.upper, color: c, dashed: true },
              { id: `${key}-middle`, label: "M", values: out.middle, color: c },
              { id: `${key}-lower`, label: "L", values: out.lower, color: c, dashed: true },
            ]
          : [{ id: key, label: "", values: Object.values(out)[0], color: c }];
      overlays.push({ key, label, ind, lines, hidden });
    } else if (ind.type === "rsi") {
      lowers.push({ key, label, ind, hidden, lines: [{ id: key, label: "", values: out.rsi, color: indicatorColors.rsi }] });
    } else if (ind.type === "macd") {
      lowers.push({
        key,
        label,
        ind,
        lines: [
          { id: `${key}-macd`, label: "MACD", values: out.macd, color: indicatorColors.macd },
          { id: `${key}-signal`, label: "Signal", values: out.signal, color: indicatorColors.signal },
          { id: `${key}-histogram`, label: "Hist", values: out.histogram, color: theme.muted },
        ],
        histogram: out.histogram,
        hidden,
      });
    } else if (ind.type === "kdj") {
      lowers.push({
        key,
        label,
        ind,
        lines: [
          { id: `${key}-k`, label: "K", values: out.k, color: indicatorColors.k },
          { id: `${key}-d`, label: "D", values: out.d, color: indicatorColors.d },
          { id: `${key}-j`, label: "J", values: out.j, color: indicatorColors.j },
        ],
        hidden,
      });
    }
  }
  return { overlays, lowers };
}

/** Pixel layout of the main price grid and each lower pane, from the chart height. */
function paneLayout(height: number, lowerCount: number) {
  const sub = lowerCount ? Math.max(56, Math.min(130, Math.round(height * 0.17))) : 0;
  const mainBottom = GRID.bottom + lowerCount * sub;
  const lowers = Array.from({ length: lowerCount }, (_, i) => {
    const top = height - GRID.bottom - (lowerCount - i) * sub + SUB_GAP;
    return { top, height: sub - SUB_GAP };
  });
  return { mainBottom, mainHeight: height - GRID.top - mainBottom, lowers };
}

export function ChartPanel(p: Props) {
  const { bars, indicators, crosshair, timeframe } = p;
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const viewKey = useRef("");
  const prevLen = useRef(0);
  const win = useRef<Window>({ start: 0, end: 0 });
  const appliedRange = useRef(0);
  const barsRef = useRef<Bar[]>(bars);
  barsRef.current = bars;
  const [hover, setHover] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setGeomTick] = useState(0); // bumped after each chart render so drawings re-project

  const daily = timeframe === "1D";
  const dailyRef = useRef(daily);
  dailyRef.current = daily;
  const lowerCountRef = useRef(0);
  const volume = indicators.find((i) => i.type === "volume");
  const showVolume = !!volume && !volume.hidden;
  const [selectedStudy, setSelectedStudy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    ind: Indicator;
    draft: Record<string, string>;
    error: string;
    at: { top: number; left: number };
  } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const studyActions = {
    selected: selectedStudy,
    select: (key: string) => setSelectedStudy((k) => (k === key ? null : key)),
    toggle: (ind: Indicator) =>
      p.onIndicators(
        indicators.map((i) => (indicatorKey(i) === indicatorKey(ind) ? ({ ...i, hidden: !i.hidden } as Indicator) : i)),
      ),
    remove: (ind: Indicator) => {
      setSelectedStudy(null);
      p.onIndicators(indicators.filter((i) => indicatorKey(i) !== indicatorKey(ind)));
    },
    edit: (ind: Indicator, anchor: HTMLElement) => {
      const a = anchor.getBoundingClientRect();
      const box = sectionRef.current!.getBoundingClientRect();
      const top = Math.min(a.bottom - box.top + 4, box.height - 190); // keep it inside the pane
      setEditing({
        ind,
        at: { top: Math.max(4, top), left: Math.max(4, Math.min(a.left - box.left, box.width - 270)) },
        error: "",
        draft: Object.fromEntries(
          catalogEntry(ind.type).params.map((x) => [x.name, String((ind as unknown as Record<string, number>)[x.name])]),
        ),
      });
    },
  };
  const studies = useMemo(() => buildStudies(bars, indicators), [bars, indicators]);
  lowerCountRef.current = studies.lowers.length;
  const layout = paneLayout(size.h, studies.lowers.length);

  // Create the chart once.
  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("updateAxisPointer", (e: unknown) => {
      const info = (e as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo ?? [];
      const x = info.find((a) => a.axisDim === "x");
      setHover(x ? Number(x.value) : null);
    });
    let raf = 0;
    c.on("rendered", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), setGeomTick((t) => t + 1)));
    });
    c.on("datazoom", () => {
      const dz = (c.getOption() as { dataZoom?: { startValue: number; endValue: number }[] }).dataZoom?.[0];
      if (!dz) return;
      win.current = { start: dz.startValue, end: dz.endValue };
      if (el.current) el.current.dataset.window = `${dz.startValue}-${dz.endValue}`;
      const labels = axisLabels(barsRef.current, dailyRef.current, win.current, c.getWidth());
      const n = lowerCountRef.current;
      c.setOption({ xAxis: Array.from({ length: n + 1 }, (_, i) => (i === n ? labels : {})) });
    });
    const ro = new ResizeObserver(() => {
      c.resize();
      setNarrow(c.getWidth() < NARROW_PX || c.getHeight() < SHORT_PX);
      setSize({ w: c.getWidth(), h: c.getHeight() });
    });
    ro.observe(el.current);
    const node = el.current;
    const leave = () => setHover(null);
    node.addEventListener("mouseleave", leave);
    return () => {
      ro.disconnect();
      node.removeEventListener("mouseleave", leave);
      c.dispose();
      chart.current = null;
    };
  }, []);

  // Render data, keeping the user's zoom window (and following the live edge).
  useEffect(() => {
    const c = chart.current;
    if (!c || size.h === 0) return;
    const n = bars.length;
    const studyKeys = [...studies.overlays, ...studies.lowers].map((s) => `${s.key}${s.hidden ? "~" : ""}`).join(",");
    const key = `${p.barsKey}|${showVolume}|${studyKeys}|${crosshair}`;
    const fresh = key !== viewKey.current || prevLen.current === 0;
    let w: Window;
    if (fresh) {
      w = { start: Math.max(0, n - VISIBLE_BARS), end: Math.max(0, n - 1 + RIGHT_PAD) };
    } else {
      const old = win.current;
      const following = old.end >= prevLen.current - 1;
      const shift = following ? n - prevLen.current : 0;
      w = { start: Math.max(0, old.start + shift), end: Math.min(n - 1 + FUTURE_SLOTS, old.end + shift) };
    }
    const r = p.range;
    if (r && r.nonce !== appliedRange.current && p.barsKey === `${r.ticker}|${r.tf}` && n > 0) {
      appliedRange.current = r.nonce;
      w = { start: rangeStart(bars, r), end: n - 1 + RIGHT_PAD };
    }
    viewKey.current = key;
    prevLen.current = n;
    win.current = w;
    if (el.current) {
      el.current.dataset.window = `${w.start}-${w.end}`;
      el.current.dataset.bars = String(n);
    }
    c.setOption(buildOption(bars, studies, showVolume, crosshair, daily, w, size.w, size.h), {
      notMerge: fresh,
      lazyUpdate: true,
    });
  }, [bars, studies, showVolume, crosshair, daily, p.barsKey, p.range, size]);

  // Navigation used by the left rail, the on-chart buttons and the keyboard.
  useEffect(() => {
    const go = (w: Window) => chart.current?.dispatchAction({ type: "dataZoom", startValue: w.start, endValue: w.end });
    const n = () => barsRef.current.length;
    const maxEnd = () => n() - 1 + FUTURE_SLOTS;
    const zoom = (factor: number) => {
      const { start, end } = win.current;
      const span = Math.min(maxEnd() + 1, Math.max(MIN_SPAN, Math.round((end - start + 1) * factor)));
      go({ start: Math.max(0, end - span + 1), end });
    };
    const pan = (dir: number) => {
      const { start, end } = win.current;
      const span = end - start;
      const step = Math.max(1, Math.round((span + 1) * 0.25)) * dir;
      const s = Math.min(Math.max(0, start + step), Math.max(0, maxEnd() - span));
      go({ start: s, end: s + span });
    };
    p.controls.current = {
      zoomIn: () => zoom(0.6),
      zoomOut: () => zoom(1.6),
      panLeft: () => pan(-1),
      panRight: () => pan(1),
      reset: () => go({ start: Math.max(0, n() - VISIBLE_BARS), end: Math.max(0, n() - 1 + RIGHT_PAD) }),
    };
  }, [p.controls]);

  useEffect(() => setHover(null), [p.barsKey]);
  useEffect(() => {
    if (!selectedStudy) return;
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-study]")) setSelectedStudy(null);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [selectedStudy]);

  const onKey = (e: React.KeyboardEvent) => {
    const c = p.controls.current;
    if (!c || e.target !== e.currentTarget) return;
    const map: Record<string, () => void> = {
      ArrowLeft: c.panLeft,
      ArrowRight: c.panRight,
      "+": c.zoomIn,
      "=": c.zoomIn,
      "-": c.zoomOut,
      "0": c.reset,
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  const idx = hover != null && hover < bars.length ? hover : bars.length - 1;
  return (
    <section
      ref={sectionRef}
      className="group relative flex min-h-0 flex-1 flex-col bg-bg outline-none"
      aria-label="Price chart. Arrow keys pan, plus and minus zoom, 0 resets."
      tabIndex={0}
      onKeyDown={onKey}
      data-testid="chart"
    >
      <Legend
        {...p}
        idx={idx}
        overlays={studies.overlays}
        volume={volume ?? null}
        actions={studyActions}
        daily={daily}
        narrow={narrow}
        collapsed={collapsed}
        onCollapse={setCollapsed}
      />
      <div className="relative min-h-0 flex-1">
        <div ref={el} className="absolute inset-0" data-testid="chart-canvas" />
        {studies.lowers.map((s, i) =>
          layout.lowers[i] ? (
            <LowerLegend key={s.key} study={s} idx={idx} top={layout.lowers[i].top - SUB_GAP + 1} actions={studyActions} />
          ) : null,
        )}
        <DrawingLayer
          geom={geometry(chart.current, bars, win.current, timeframe, layout.mainBottom)}
          drawings={p.drawings}
          tool={p.tool}
          magnet={p.magnet}
          daily={daily}
          selectedId={p.selectedDrawing}
          onCreate={p.onCreateDrawing}
          onMove={p.onMoveDrawing}
          onSelect={p.onSelectDrawing}
          onDelete={p.onDeleteDrawing}
        />
      </div>
      {editing && (
        <IndicatorSettings
          editing={editing}
          onDraft={(draft) => setEditing({ ...editing, draft, error: "" })}
          onCancel={() => setEditing(null)}
          onApply={() => {
            const next = { ...editing.ind } as Record<string, unknown>;
            for (const [k, v] of Object.entries(editing.draft)) next[k] = Number(v);
            const ind = next as Indicator;
            const err = validate(ind, indicators, indicatorKey(editing.ind));
            if (err) return setEditing({ ...editing, error: err });
            p.onIndicators(indicators.map((i) => (indicatorKey(i) === indicatorKey(editing.ind) ? ind : i)));
            setEditing(null);
            setSelectedStudy(null);
          }}
        />
      )}
      <ChartNav controls={p.controls} bottom={layout.mainBottom + 12} />
      {p.overlay && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            data-testid="chart-overlay"
            className="rounded-md border border-line-strong bg-overlay px-5 py-3 text-center backdrop-blur-sm"
          >
            <div className="text-[15px] font-semibold text-strong">{p.overlay.title}</div>
            <div className="mt-0.5 text-[12px] text-muted">{p.overlay.body}</div>
          </div>
        </div>
      )}
    </section>
  );
}

const fmtValue = (v: number | null | undefined) => (v == null ? "—" : fmtPrice(Math.abs(v) < 0.005 ? 0 : v));

type StudyActions = {
  selected: string | null;
  select: (key: string) => void;
  toggle: (ind: Indicator) => void;
  remove: (ind: Indicator) => void;
  edit: (ind: Indicator, anchor: HTMLElement) => void;
};

/** One indicator's legend row: name, settings, values; hover or click shows its actions. */
function StudyRow({
  ind,
  color,
  actions,
  children,
}: {
  ind: Indicator;
  color: string;
  actions: StudyActions;
  children: React.ReactNode;
}) {
  const key = indicatorKey(ind);
  const selected = actions.selected === key;
  const icon = (
    label: string,
    testId: string,
    onClick: (el: HTMLElement) => void,
    node: React.ReactNode,
    pressed?: boolean,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget);
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-strong"
    >
      {node}
    </button>
  );
  return (
    <div
      data-study={key}
      data-testid={`study-${key}`}
      data-hidden={!!ind.hidden}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => actions.select(key)}
      onKeyDown={(e) => e.key === "Enter" && actions.select(key)}
      className={`group/row pointer-events-auto inline-flex h-6 cursor-pointer items-center gap-1.5 rounded border px-1.5 ${
        selected ? "border-line-strong bg-raised" : "border-transparent hover:border-line hover:bg-raised/70"
      }`}
    >
      <span className={ind.hidden ? "text-faint" : ""} style={ind.hidden ? undefined : { color }}>
        {shortName(ind)}
      </span>
      {catalogEntry(ind.type).params.length > 0 && <span className="text-faint">{paramsText(ind)}</span>}
      {!ind.hidden && children}
      <span className={`items-center gap-0.5 ${selected ? "flex" : "hidden group-hover/row:flex group-focus/row:flex"}`}>
        {icon(
          ind.hidden ? "Show" : "Hide",
          `study-hide-${key}`,
          () => actions.toggle(ind),
          ind.hidden ? <EyeOff size={13} /> : <Eye size={13} />,
          !!ind.hidden,
        )}
        {catalogEntry(ind.type).params.length > 0 &&
          icon("Settings", `study-settings-${key}`, (el) => actions.edit(ind, el), <Settings2 size={13} />)}
        {icon("Remove", `study-remove-${key}`, () => actions.remove(ind), <Trash2 size={13} />)}
      </span>
    </div>
  );
}

function LowerLegend({ study, idx, top, actions }: { study: Study; idx: number; top: number; actions: StudyActions }) {
  return (
    <div
      className="pointer-events-none absolute left-2 z-10 flex items-center text-[11px]"
      style={{ top: top - 4 }}
      data-testid={`lower-${study.key}`}
    >
      <StudyRow ind={study.ind} color={study.lines[0].color} actions={actions}>
        {study.lines.map((l) => (
          <span key={l.id} className="inline-flex items-baseline gap-0.5">
            {l.label && <span className="text-muted">{l.label}</span>}
            <span className="num" style={{ color: l.color }} data-testid={`legend-${l.id}`}>
              {fmtValue(l.values[idx])}
            </span>
          </span>
        ))}
      </StudyRow>
    </div>
  );
}

/** Popover to edit one indicator's settings. */
function IndicatorSettings({
  editing,
  onDraft,
  onCancel,
  onApply,
}: {
  editing: { ind: Indicator; draft: Record<string, string>; error: string; at: { top: number; left: number } };
  onDraft: (d: Record<string, string>) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const entry = catalogEntry(editing.ind.type);
  return (
    <div
      data-study="settings"
      data-testid="indicator-settings"
      role="dialog"
      aria-label={`${entry.name} settings`}
      style={{ top: editing.at.top, left: editing.at.left }}
      className="absolute z-30 w-64 rounded-md border border-line-strong bg-raised p-3 shadow-2xl"
      onKeyDown={(e) => {
        if (e.key === "Enter") onApply();
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="mb-2 text-[13px] font-semibold text-strong">{entry.name}</div>
      <div className="flex flex-col gap-2">
        {entry.params.map((p) => (
          <label key={p.name} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-muted">{p.label}</span>
            <input
              type="number"
              step={p.int ? 1 : 0.1}
              min={p.min}
              max={p.max}
              data-testid={`settings-${p.name}`}
              value={editing.draft[p.name]}
              onChange={(e) => onDraft({ ...editing.draft, [p.name]: e.target.value })}
              className="h-7 w-20 rounded border border-line bg-bg px-2 text-right text-[12px] outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
      {editing.error && (
        <p role="alert" data-testid="settings-error" className="mt-2 text-[11px] text-down">
          {editing.error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          type="button"
          data-testid="settings-cancel"
          onClick={onCancel}
          className="h-7 rounded px-3 text-[12px] text-muted hover:bg-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="settings-apply"
          onClick={onApply}
          className="h-7 rounded bg-accent px-3 text-[12px] font-medium text-strong hover:brightness-110"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function ChartNav({ controls, bottom }: { controls: MutableRefObject<ChartControls | null>; bottom: number }) {
  const btn = (label: string, testId: string, fn: keyof ChartControls, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={() => controls.current?.[fn]()}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-raised text-muted shadow-lg hover:border-line-strong hover:text-strong"
    >
      {icon}
    </button>
  );
  return (
    <div
      className="absolute left-1/2 z-10 flex -translate-x-1/2 gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      style={{ bottom }}
      data-testid="chart-nav"
    >
      {btn("Zoom out", "chart-zoom-out", "zoomOut", <Minus size={14} />)}
      {btn("Zoom in", "chart-zoom-in", "zoomIn", <Plus size={14} />)}
      {btn("Scroll left", "chart-pan-left", "panLeft", <ChevronLeft size={15} />)}
      {btn("Scroll right", "chart-pan-right", "panRight", <ChevronRight size={15} />)}
      {btn("Reset view", "chart-reset", "reset", <RotateCcw size={13} />)}
    </div>
  );
}

function Legend(
  p: Props & {
    idx: number;
    overlays: Study[];
    volume: Indicator | null;
    actions: StudyActions;
    daily: boolean;
    narrow: boolean;
    collapsed: boolean;
    onCollapse: (v: boolean) => void;
  },
) {
  const bar = p.bars[p.idx];
  const prev = p.idx > 0 ? p.bars[p.idx - 1].c : bar?.o;
  const chg = bar && prev != null ? Math.round((bar.c - prev) * 100) / 100 : 0;
  const chgPct = bar && prev ? (chg / prev) * 100 : 0;
  const tone = bar ? toneClass(bar.c - bar.o) : "";
  const item = (label: string, value: string, testId: string, cls = tone) => (
    <span className="inline-flex items-baseline gap-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num ${cls}`} data-testid={testId}>
        {value}
      </span>
    </span>
  );
  const q = p.quote;
  return (
    <div
      className="pointer-events-none absolute top-2 left-3 z-10 flex max-w-[calc(100%-90px)] flex-col items-start gap-1.5 text-[12px]"
      data-testid="chart-legend"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="text-[14px] font-semibold text-strong" data-testid="legend-ticker">
          {p.ticker}
        </span>
        {!p.narrow && <span className="text-text">{p.name}</span>}
        <span className="text-faint">·</span>
        <span className="text-text" data-testid="legend-timeframe">
          {p.timeframe}
        </span>
        <span className="text-faint">·</span>
        <span className="num text-muted" data-testid="legend-time">
          {bar ? fmtBarTime(bar, p.daily) : "—"}
        </span>
        {bar && (
          <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-2">
            {item("O", fmtPrice(bar.o), "legend-o")}
            {item("H", fmtPrice(bar.h), "legend-h")}
            {item("L", fmtPrice(bar.l), "legend-l")}
            {item("C", fmtPrice(bar.c), "legend-c")}
            <span className={`num ${toneClass(chg)}`} data-testid="legend-chg">
              {fmtSigned(chg)} ({fmtPct(chgPct)})
            </span>
          </span>
        )}
      </div>
      {!p.collapsed && (
        <>
          {!p.narrow && (
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                data-testid="legend-sell"
                disabled={p.closed || !q}
                onClick={() => p.onQuickTrade("sell")}
                className="flex min-w-20 flex-col items-center rounded border border-down/60 bg-bg/80 px-2.5 py-0.5 leading-tight text-down hover:bg-down-soft disabled:opacity-40"
              >
                <span className="num text-[13px]">{fmtPrice(q?.bid)}</span>
                <span className="text-[10px] font-semibold tracking-wider">SELL</span>
              </button>
              <span className="num text-[11px] text-muted" title="Spread">
                {q ? (q.ask - q.bid).toFixed(2) : "—"}
              </span>
              <button
                type="button"
                data-testid="legend-buy"
                disabled={p.closed || !q}
                onClick={() => p.onQuickTrade("buy")}
                className="flex min-w-20 flex-col items-center rounded border border-accent/70 bg-bg/80 px-2.5 py-0.5 leading-tight text-accent hover:bg-accent-soft disabled:opacity-40"
              >
                <span className="num text-[13px]">{fmtPrice(q?.ask)}</span>
                <span className="text-[10px] font-semibold tracking-wider">BUY</span>
              </button>
            </div>
          )}
          {(p.volume || p.overlays.length > 0) && (
            <div className="-ml-1.5 flex flex-col items-start gap-0.5">
              {p.volume && bar && (
                <StudyRow ind={p.volume} color={theme.muted} actions={p.actions}>
                  <span className="num text-text" data-testid="legend-vol">
                    {fmtInt(bar.v)}
                  </span>
                </StudyRow>
              )}
              {p.overlays.map((s) => (
                <StudyRow key={s.key} ind={s.ind} color={s.lines[0].color} actions={p.actions}>
                  {s.lines.map((l) => (
                    <span key={l.id} className="inline-flex items-baseline gap-0.5">
                      {l.label && <span className="text-muted">{l.label}</span>}
                      <span className="num" style={{ color: l.color }} data-testid={`legend-${l.id}`}>
                        {fmtValue(l.values[p.idx])}
                      </span>
                    </span>
                  ))}
                </StudyRow>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        aria-label={p.collapsed ? "Expand legend" : "Collapse legend"}
        data-testid="legend-toggle"
        onClick={() => p.onCollapse(!p.collapsed)}
        className="pointer-events-auto flex h-5 w-6 items-center justify-center rounded border border-line bg-bg/80 text-muted hover:text-text"
      >
        {p.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>
    </div>
  );
}

/** Main-plot rectangle and data<->pixel mapping for the drawing layer (null until rendered). */
function geometry(
  c: echarts.ECharts | null,
  bars: Bar[],
  w: Window,
  tf: string,
  mainBottom: number,
): Geometry | null {
  if (!c || c.isDisposed() || bars.length === 0) return null;
  const width = c.getWidth();
  const height = c.getHeight();
  if (width === 0 || height === 0) return null;
  return {
    rect: { x: GRID.left, y: GRID.top, width: width - GRID.left - GRID.right, height: height - GRID.top - mainBottom },
    start: w.start,
    end: w.end,
    bars,
    tfSeconds: TF_SECONDS[tf] ?? 60,
    futureSlots: FUTURE_SLOTS,
    priceToY: (price) => Number(c.convertToPixel({ yAxisIndex: 0 }, price)),
    yToPrice: (y) => Number(c.convertFromPixel({ yAxisIndex: 0 }, y)),
  };
}

function rangeStart(bars: Bar[], r: RangeRequest): number {
  let from = r.fromDate;
  if (r.sessions != null) {
    const dates = [...new Set(bars.map((b) => b.date))];
    from = dates[Math.max(0, dates.length - r.sessions)];
  }
  const i = bars.findIndex((b) => from != null && b.date >= from);
  return i < 0 ? 0 : i;
}

/** Which category indices get a time-axis label, and what each says. */
function axisLabels(bars: Bar[], daily: boolean, w: Window, widthPx: number) {
  const visible = Math.max(1, w.end - w.start + 1);
  const step = Math.max(1, Math.ceil(visible / Math.max(2, Math.floor((widthPx - 80) / LABEL_PX))));
  const show = new Set<number>();
  const text = new Map<number, string>();
  if (daily) {
    bars.forEach((b, i) => {
      const monthStart = i === 0 || b.date.slice(0, 7) !== bars[i - 1].date.slice(0, 7);
      if (monthStart && (step >= 8 || i % step === 0)) {
        show.add(i);
        text.set(i, fmtMonth(b.date));
      } else if (step < 8 && i % step === 0) {
        show.add(i);
        text.set(i, String(Number(b.date.slice(8))));
      }
    });
  } else {
    const starts: number[] = [];
    bars.forEach((b, i) => {
      if (i === 0 || b.date !== bars[i - 1].date) starts.push(i);
    });
    const perSession = bars.length / Math.max(1, starts.length);
    if (step >= perSession * 0.75) {
      const every = Math.max(1, Math.round(step / perSession));
      starts.forEach((s, k) => {
        if (k % every === 0) {
          show.add(s);
          text.set(s, fmtDay(bars[s].date));
        }
      });
    } else {
      starts.forEach((s, k) => {
        const end = k + 1 < starts.length ? starts[k + 1] : bars.length;
        show.add(s);
        text.set(s, fmtDay(bars[s].date));
        for (let i = s + step; i < end - step * 0.5; i += step) {
          show.add(i);
          text.set(i, bars[i].label);
        }
      });
    }
  }
  return {
    axisLabel: {
      show: true,
      interval: (i: number) => show.has(i),
      // category values are the bar indices (the formatter's own index arg is not)
      formatter: (v: string) => text.get(Number(v)) ?? "",
      color: theme.muted,
      fontSize: 11,
      hideOverlap: true,
    },
  };
}

function buildOption(
  bars: Bar[],
  studies: { overlays: Study[]; lowers: Study[] },
  showVolume: boolean,
  crosshair: boolean,
  daily: boolean,
  w: Window,
  widthPx: number,
  heightPx: number,
) {
  const last = bars[bars.length - 1];
  const lastUp = last ? last.c >= last.o : true;
  const pointerLabel = { backgroundColor: theme.borderStrong, color: theme.textStrong, fontSize: 11 };
  const lay = paneLayout(heightPx, studies.lowers.length);
  const nGrids = 1 + studies.lowers.length;
  const categories = Array.from({ length: bars.length + FUTURE_SLOTS }, (_, i) => String(i));
  const labels = axisLabels(bars, daily, w, widthPx);
  const xIndices = Array.from({ length: nGrids }, (_, i) => i);

  const lineSeries = (l: Line, xAxisIndex: number, yAxisIndex: number) => ({
    name: l.id,
    type: "line",
    xAxisIndex,
    yAxisIndex,
    data: l.values,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { color: l.color, width: 1.3, type: l.dashed ? "dashed" : "solid" },
    itemStyle: { color: l.color },
    silent: true,
  });

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: "ui-sans-serif, system-ui, sans-serif" },
    tooltip: {
      trigger: "axis",
      showContent: false,
      axisPointer: {
        type: crosshair ? "cross" : "line",
        lineStyle: { color: theme.crosshair, type: "dashed", width: 1 },
        crossStyle: { color: theme.crosshair, type: "dashed", width: 1 },
        label: {
          ...pointerLabel,
          formatter: (p: { axisDimension: string; value: number | string }) => {
            if (p.axisDimension === "y") return Number(p.value).toFixed(2);
            const b = bars[Number(p.value)];
            return b ? fmtBarTime(b, daily) : "";
          },
        },
      },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: GRID.left, right: GRID.right, top: GRID.top, bottom: lay.mainBottom },
      ...lay.lowers.map((g) => ({ left: GRID.left, right: GRID.right, top: g.top, height: g.height })),
    ],
    xAxis: xIndices.map((gridIndex) => ({
      type: "category",
      gridIndex,
      data: categories,
      boundaryGap: true,
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: theme.grid } },
      ...(gridIndex === nGrids - 1 ? labels : { axisLabel: { show: false } }),
    })),
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        scale: true,
        position: "right",
        min: showVolume ? (v: { min: number; max: number }) => v.min - (v.max - v.min) * 0.28 : undefined,
        axisLine: { show: false },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      { type: "value", gridIndex: 0, show: false, max: (v: { max: number }) => v.max * 4, splitLine: { show: false } },
      ...studies.lowers.map((s, i) => ({
        type: "value",
        gridIndex: i + 1,
        position: "right",
        scale: s.ind.type !== "rsi",
        min: s.ind.type === "rsi" ? 0 : undefined,
        max: s.ind.type === "rsi" ? 100 : undefined,
        splitNumber: 2,
        axisLine: { show: false },
        axisLabel: {
          color: theme.muted,
          fontSize: 10,
          showMinLabel: false, // keeps adjacent panes' edge labels from colliding
          showMaxLabel: false,
          formatter: (v: number) => v.toFixed(s.ind.type === "macd" ? 2 : 0),
        },
        splitLine: { lineStyle: { color: theme.grid } },
      })),
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: xIndices,
        startValue: w.start,
        endValue: w.end,
        minValueSpan: MIN_SPAN,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        filterMode: "filter",
      },
    ],
    series: [
      {
        name: "volume",
        type: "bar",
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: showVolume
          ? bars.map((b) => ({ value: b.v, itemStyle: { color: b.c >= b.o ? theme.volUp : theme.volDown } }))
          : [],
        barCategoryGap: "25%",
        silent: true,
      },
      {
        name: "price",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: bars.map((b) => [b.o, b.c, b.l, b.h]),
        barMaxWidth: 18,
        itemStyle: { color: theme.up, color0: theme.down, borderColor: theme.up, borderColor0: theme.down },
        markLine: last
          ? {
              silent: true,
              symbol: "none",
              data: [{ yAxis: last.c }],
              lineStyle: { color: lastUp ? theme.up : theme.down, type: "dotted", width: 1 },
              label: {
                position: "end",
                formatter: last.c.toFixed(2),
                color: theme.textStrong,
                backgroundColor: lastUp ? theme.up : theme.down,
                padding: [2, 4],
                borderRadius: 2,
                fontSize: 11,
              },
            }
          : undefined,
      },
      ...studies.overlays.filter((s) => !s.hidden).flatMap((s) => s.lines.map((l) => lineSeries(l, 0, 0))),
      ...studies.lowers.flatMap((s, i) => {
        const x = i + 1;
        const y = 2 + i;
        const out: object[] = [];
        if (s.hidden) return [{ type: "line", xAxisIndex: x, yAxisIndex: y, data: [], silent: true }];
        if (s.histogram) {
          out.push({
            name: `${s.key}-bars`,
            type: "bar",
            xAxisIndex: x,
            yAxisIndex: y,
            data: s.histogram.map((v) => ({ value: v, itemStyle: { color: (v ?? 0) >= 0 ? theme.volUp : theme.volDown } })),
            barCategoryGap: "30%",
            silent: true,
          });
        }
        for (const l of s.lines) if (!(s.histogram && l.id.endsWith("histogram"))) out.push(lineSeries(l, x, y));
        if (s.ind.type === "rsi") {
          (out[0] as Record<string, unknown>).markLine = {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: indicatorColors.rsiBand, type: "dashed", width: 1 },
            data: [{ yAxis: 30 }, { yAxis: 70 }],
          };
        }
        return out;
      }),
    ],
  };
}
