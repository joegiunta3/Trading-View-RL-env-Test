import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, RotateCcw } from "lucide-react";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { fmtBarTime, fmtDay, fmtInt, fmtMonth, fmtPct, fmtPrice, fmtSigned, toneClass } from "../format";
import { sma } from "../indicators";
import { smaColors, theme } from "../theme";
import type { Bar, Indicator, Quote } from "../types";

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

type SmaLine = { period: number; color: string; values: (number | null)[] };
type Window = { start: number; end: number };

const VISIBLE_BARS = 150;
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
  crosshair: boolean;
  controls: MutableRefObject<ChartControls | null>;
  range: RangeRequest | null;
  onQuickTrade: (side: "buy" | "sell") => void;
};

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

  const daily = timeframe === "1D";
  const dailyRef = useRef(daily);
  dailyRef.current = daily;
  const showVolume = indicators.some((i) => i.type === "volume");
  const smas: SmaLine[] = useMemo(() => {
    const closes = bars.map((b) => b.c);
    return indicators
      .filter((i): i is { type: "sma"; period: number } => i.type === "sma")
      .map((i, n) => ({ period: i.period, color: smaColors[n % smaColors.length], values: sma(closes, i.period) }));
  }, [bars, indicators]);

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
    c.on("datazoom", () => {
      const dz = (c.getOption() as { dataZoom?: { startValue: number; endValue: number }[] }).dataZoom?.[0];
      if (!dz) return;
      win.current = { start: dz.startValue, end: dz.endValue };
      if (el.current) el.current.dataset.window = `${dz.startValue}-${dz.endValue}`;
      c.setOption({ xAxis: [axisLabels(barsRef.current, dailyRef.current, win.current, c.getWidth())] });
    });
    const ro = new ResizeObserver(() => {
      c.resize();
      setNarrow(c.getWidth() < NARROW_PX || c.getHeight() < SHORT_PX);
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
    if (!c) return;
    const n = bars.length;
    const key = `${p.barsKey}|${showVolume}|${smas.map((s) => s.period).join(",")}|${crosshair}`;
    const fresh = key !== viewKey.current || prevLen.current === 0;
    let w: Window;
    if (fresh) {
      w = { start: Math.max(0, n - VISIBLE_BARS), end: Math.max(0, n - 1) };
    } else {
      const old = win.current;
      const following = old.end >= prevLen.current - 1;
      const shift = following ? n - prevLen.current : 0;
      w = { start: Math.max(0, old.start + shift), end: Math.min(n - 1, old.end + shift) };
    }
    const r = p.range;
    if (r && r.nonce !== appliedRange.current && p.barsKey === `${r.ticker}|${r.tf}` && n > 0) {
      appliedRange.current = r.nonce;
      w = { start: rangeStart(bars, r), end: n - 1 };
    }
    viewKey.current = key;
    prevLen.current = n;
    win.current = w;
    if (el.current) {
      el.current.dataset.window = `${w.start}-${w.end}`;
      el.current.dataset.bars = String(n);
    }
    c.setOption(buildOption(bars, smas, showVolume, crosshair, daily, w, c.getWidth()), {
      notMerge: fresh,
      lazyUpdate: true,
    });
  }, [bars, smas, showVolume, crosshair, daily, p.barsKey, p.range]);

  // Navigation used by the left rail, the on-chart buttons and the keyboard.
  useEffect(() => {
    const go = (w: Window) => chart.current?.dispatchAction({ type: "dataZoom", startValue: w.start, endValue: w.end });
    const n = () => barsRef.current.length;
    const zoom = (factor: number) => {
      const { start, end } = win.current;
      const span = Math.min(n(), Math.max(MIN_SPAN, Math.round((end - start + 1) * factor)));
      go({ start: Math.max(0, end - span + 1), end });
    };
    const pan = (dir: number) => {
      const { start, end } = win.current;
      const span = end - start;
      const step = Math.max(1, Math.round((span + 1) * 0.25)) * dir;
      const s = Math.min(Math.max(0, start + step), Math.max(0, n() - 1 - span));
      go({ start: s, end: s + span });
    };
    p.controls.current = {
      zoomIn: () => zoom(0.6),
      zoomOut: () => zoom(1.6),
      panLeft: () => pan(-1),
      panRight: () => pan(1),
      reset: () => go({ start: Math.max(0, n() - VISIBLE_BARS), end: Math.max(0, n() - 1) }),
    };
  }, [p.controls]);

  useEffect(() => setHover(null), [p.barsKey]);

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
      className="group relative flex min-h-0 flex-1 flex-col bg-bg outline-none"
      aria-label="Price chart. Arrow keys pan, plus and minus zoom, 0 resets."
      tabIndex={0}
      onKeyDown={onKey}
      data-testid="chart"
    >
      <Legend
        {...p}
        idx={idx}
        smas={smas}
        showVolume={showVolume}
        daily={daily}
        narrow={narrow}
        collapsed={collapsed}
        onCollapse={setCollapsed}
      />
      <div ref={el} className="min-h-0 flex-1" data-testid="chart-canvas" />
      <ChartNav controls={p.controls} />
      {p.closed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            data-testid="session-closed"
            className="rounded-md border border-line-strong bg-overlay px-5 py-3 text-center backdrop-blur-sm"
          >
            <div className="text-[15px] font-semibold text-strong">Session closed</div>
            <div className="mt-0.5 text-[12px] text-muted">
              Trading has ended for the day. Working orders were cancelled.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ChartNav({ controls }: { controls: MutableRefObject<ChartControls | null> }) {
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
      className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
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
    smas: SmaLine[];
    showVolume: boolean;
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
          {!p.narrow && <div className="pointer-events-auto flex items-center gap-2">
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
          </div>}
          {(p.showVolume || p.smas.length > 0) && (
            <div className="flex flex-wrap items-baseline gap-x-3">
              {p.showVolume && bar && item("Vol", fmtInt(bar.v), "legend-vol", "text-text")}
              {p.smas.map((s) => (
                <span key={s.period} className="inline-flex items-baseline gap-1">
                  <span style={{ color: s.color }}>SMA {s.period}</span>
                  <span className="num" style={{ color: s.color }} data-testid={`legend-sma-${s.period}`}>
                    {s.values[p.idx] == null ? "—" : fmtPrice(s.values[p.idx])}
                  </span>
                </span>
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
  smas: SmaLine[],
  showVolume: boolean,
  crosshair: boolean,
  daily: boolean,
  w: Window,
  widthPx: number,
) {
  const last = bars[bars.length - 1];
  const lastUp = last ? last.c >= last.o : true;
  const pointerLabel = { backgroundColor: theme.borderStrong, color: theme.textStrong, fontSize: 11 };

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
    grid: [{ left: 10, right: 72, top: 16, bottom: 28 }],
    xAxis: [
      {
        type: "category",
        data: bars.map((_, i) => String(i)),
        boundaryGap: true,
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: theme.grid } },
        ...axisLabels(bars, daily, w, widthPx),
      },
    ],
    yAxis: [
      {
        type: "value",
        scale: true,
        position: "right",
        min: showVolume ? (v: { min: number; max: number }) => v.min - (v.max - v.min) * 0.28 : undefined,
        axisLine: { show: false },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      { type: "value", show: false, max: (v: { max: number }) => v.max * 4, splitLine: { show: false } },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
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
      ...smas.map((s) => ({
        name: `sma${s.period}`,
        type: "line",
        yAxisIndex: 0,
        data: s.values,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: s.color, width: 1.4 },
        itemStyle: { color: s.color },
        silent: true,
      })),
    ],
  };
}
