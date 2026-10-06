import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { ChartLine, Eye, EyeOff, List, Maximize2, Minimize2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { fmtInt, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, toneClass } from "../format";
import { DIRECTION_OPTIONS, strategyLabel } from "../strategies";
import { strategyColors, theme } from "../theme";
import type { Backtest, BacktestTrade } from "../types";
import { Empty } from "./ui";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

type View = "overview" | "trades";

/** Bottom-panel Strategy Tester for the active pane's strategy: key stats, performance, trades. */
export function StrategyTester({
  backtest,
  hasStrategy,
  expanded,
  onToggleExpand,
}: {
  backtest: Backtest | null;
  hasStrategy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [view, setView] = useState<View>("overview");
  if (!hasStrategy)
    return <Empty>No strategy on this chart. Add one from Indicators → Strategies.</Empty>;
  if (!backtest) return <Empty>Running backtest…</Empty>;
  const s = backtest.stats;
  const dir = DIRECTION_OPTIONS.find((d) => d.value === backtest.strategy.direction)?.label;
  const tab = (id: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={view === id}
      data-testid={`tester-view-${id}`}
      onClick={() => setView(id)}
      className={`flex h-7 w-8 items-center justify-center rounded ${
        view === id ? "bg-accent-soft text-accent ring-1 ring-accent" : "text-muted hover:bg-hover hover:text-text"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="strategy-tester">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5">
        <span className="text-[13px] font-semibold text-strong" data-testid="tester-name">
          {strategyLabel(backtest.strategy)}
        </span>
        <div className="flex gap-1 rounded bg-bg p-0.5">
          {tab("overview", "Overview", <ChartLine size={15} />)}
          {tab("trades", "List of trades", <List size={15} />)}
        </div>
        <span className="text-[12px] text-muted" data-testid="tester-range">
          {backtest.range.from} — {backtest.range.to}
        </span>
        <span className="text-[11px] text-faint">
          {backtest.ticker} · {backtest.timeframe} · {fmtUsd(backtest.initial_capital)} capital ·{" "}
          {fmtInt(backtest.strategy.qty)} shares per trade · {dir}
        </span>
        <button
          type="button"
          aria-label={expanded ? "Collapse panel" : "Expand panel"}
          title={expanded ? "Collapse panel" : "Expand panel"}
          data-testid="tester-expand"
          onClick={onToggleExpand}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text"
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "overview" ? <Overview backtest={backtest} /> : <TradesTable trades={backtest.trades} />}
      </div>
      <span className="hidden" data-testid="tester-total-trades">
        {s.total_trades}
      </span>
    </div>
  );
}

function Overview({ backtest }: { backtest: Backtest }) {
  const s = backtest.stats;
  const [showBuyHold, setShowBuyHold] = useState(false);
  const stat = (label: string, testId: string, main: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-36" data-testid={testId}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="num mt-0.5 flex items-baseline gap-2 text-[17px] text-strong">
        {main}
        {sub && <span className="text-[13px]">{sub}</span>}
      </div>
    </div>
  );
  const small = (label: string, testId: string, value: React.ReactNode) => (
    <div className="flex items-baseline gap-1.5 text-[12px]" data-testid={testId}>
      <span className="text-muted">{label}</span>
      <span className="num text-text">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[14px] font-semibold text-strong">Key stats</div>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {stat(
          "Total PnL",
          "stat-total-pnl",
          <span className={toneClass(s.total_pnl)}>{fmtSignedUsd(s.total_pnl)}</span>,
          <span className={toneClass(s.total_pnl)}>{fmtPct(s.total_pnl_pct)}</span>,
        )}
        {stat("Max drawdown", "stat-max-drawdown", fmtUsd(s.max_drawdown), `${s.max_drawdown_pct.toFixed(2)}%`)}
        {stat(
          "Profitable trades",
          "stat-profitable",
          `${s.percent_profitable.toFixed(2)}%`,
          `${s.winning_trades}/${s.total_trades}`,
        )}
        {stat("Profit factor", "stat-profit-factor", s.profit_factor == null ? "—" : s.profit_factor.toFixed(3))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {small("Avg trade", "stat-avg-trade", fmtSignedUsd(s.avg_trade))}
        {small("Largest win", "stat-largest-win", fmtSignedUsd(s.largest_win))}
        {small("Largest loss", "stat-largest-loss", fmtSignedUsd(s.largest_loss))}
        {small("Open PnL", "stat-open-pnl", fmtSignedUsd(s.open_pnl))}
        {small("Buy & hold", "stat-buy-hold", `${fmtSignedUsd(s.buy_hold_pnl)} (${fmtPct(s.buy_hold_pct)})`)}
      </div>
      <div className="mt-1 flex items-center gap-3">
        <span className="text-[14px] font-semibold text-strong">Performance</span>
        <span className="text-[12px] text-text">Cumulative PnL</span>
        <button
          type="button"
          data-testid="tester-buy-hold"
          aria-pressed={showBuyHold}
          onClick={() => setShowBuyHold((v) => !v)}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] hover:bg-hover ${
            showBuyHold ? "text-text" : "text-faint"
          }`}
        >
          Buy and hold {showBuyHold ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>
      <PerformanceChart backtest={backtest} showBuyHold={showBuyHold} />
    </div>
  );
}

function PerformanceChart({ backtest, showBuyHold }: { backtest: Backtest; showBuyHold: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);
  useEffect(() => {
    const eq = backtest.equity;
    chart.current?.setOption(
      {
        animation: false,
        grid: { left: 8, right: 64, top: 8, bottom: 8 },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.panelRaised,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.text, fontSize: 11 },
          valueFormatter: (v: number) => fmtSignedUsd(v),
        },
        xAxis: { type: "category", data: eq.map((_, i) => i), show: false },
        yAxis: {
          type: "value",
          position: "right",
          splitLine: { lineStyle: { color: theme.grid, type: "dotted" } },
          axisLabel: { color: theme.muted, fontSize: 10, formatter: (v: number) => fmtPrice(v) },
        },
        series: [
          // Cumulative PnL split at zero: green above, red below (two area series on one baseline).
          {
            name: "Cumulative PnL",
            type: "line",
            data: eq.map((e) => Math.max(e.pnl, 0)),
            showSymbol: false,
            lineStyle: { width: 1.5, color: theme.up },
            itemStyle: { color: theme.up },
            areaStyle: { color: theme.up, opacity: 0.12 },
          },
          {
            name: "Cumulative PnL (loss)",
            type: "line",
            data: eq.map((e) => Math.min(e.pnl, 0)),
            showSymbol: false,
            lineStyle: { width: 1.5, color: theme.down },
            itemStyle: { color: theme.down },
            areaStyle: { color: theme.down, opacity: 0.12 },
            tooltip: { show: false },
          },
          {
            name: "Buy and hold",
            type: "line",
            data: showBuyHold ? eq.map((e) => e.buy_hold) : [],
            showSymbol: false,
            lineStyle: { width: 1, color: theme.muted, type: "dashed" },
            itemStyle: { color: theme.muted },
          },
        ],
      },
      { notMerge: true },
    );
  }, [backtest, showBuyHold]);
  return <div ref={el} className="h-40 min-h-40 w-full" data-testid="tester-performance" />;
}

function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length === 0) return <Empty>No trades yet in this range.</Empty>;
  const th = "sticky top-0 z-10 bg-panel px-3 py-2 text-left text-[11px] font-normal text-muted";
  const td = "px-3 py-1.5 whitespace-nowrap";
  return (
    <table className="w-full border-collapse text-[12px]" data-testid="trades-table">
      <thead>
        <tr>
          <th className={th}>Trade number</th>
          <th className={th}>Type</th>
          <th className={th}>Date and time</th>
          <th className={`${th} text-right`}>Price</th>
          <th className={`${th} text-right`}>Size</th>
          <th className={`${th} text-right`}>Net PnL</th>
          <th className={`${th} text-right`}>Return</th>
        </tr>
      </thead>
      <tbody>
        {[...trades].reverse().map((t) => {
          const sideColor = t.side === "long" ? strategyColors.long : strategyColors.short;
          return (
            <Fragment key={t.number}>
              <tr data-testid={`trade-${t.number}-exit`} className="border-t border-line">
                <td className={`${td} align-middle`} rowSpan={2}>
                  <span className="num text-text">{t.number}</span>{" "}
                  <span style={{ color: sideColor }} data-testid={`trade-${t.number}-side`}>
                    {t.side === "long" ? "Long" : "Short"}
                  </span>
                </td>
                <td className={td}>{t.open ? "Open" : "Exit"}</td>
                <td className={`${td} num`}>{t.open ? "—" : t.exit_when}</td>
                <td className={`${td} num text-right`} data-testid={`trade-${t.number}-exit-price`}>
                  {t.open ? fmtPrice(t.mark_price) : fmtPrice(t.exit_price)}
                </td>
                <td className={`${td} num text-right align-middle`} rowSpan={2}>
                  <div>{fmtInt(t.qty)}</div>
                  <div className="text-muted">{fmtUsd(t.notional)}</div>
                </td>
                <td
                  className={`${td} num text-right align-middle ${toneClass(t.pnl)}`}
                  rowSpan={2}
                  data-testid={`trade-${t.number}-pnl`}
                >
                  {fmtSignedUsd(t.pnl)}
                </td>
                <td className={`${td} num text-right align-middle ${toneClass(t.pnl)}`} rowSpan={2}>
                  {fmtPct(t.return_pct)}
                </td>
              </tr>
              <tr data-testid={`trade-${t.number}-entry`} className="border-t border-line/40">
                <td className={td}>Entry</td>
                <td className={`${td} num`}>{t.entry_when}</td>
                <td className={`${td} num text-right`} data-testid={`trade-${t.number}-entry-price`}>
                  {fmtPrice(t.entry_price)}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
