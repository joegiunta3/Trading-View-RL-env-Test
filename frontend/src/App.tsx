import { Maximize2, Minimize2 } from "lucide-react";
import { createRef, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { Alerts } from "./components/Alerts";
import { BottomPanel } from "./components/BottomPanel";
import { type ChartControls, ChartPanel, type RangeRequest } from "./components/ChartPanel";
import { LeftRail } from "./components/LeftRail";
import { OrderTicket, type TicketPrefill } from "./components/OrderTicket";
import { RangeBar, type RangePreset, rangePresets } from "./components/RangeBar";
import { Screener } from "./components/Screener";
import { SymbolDetails } from "./components/SymbolDetails";
import { type Toast, Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { Tabs } from "./components/ui";
import { Watchlists } from "./components/Watchlists";
import { loadConfig } from "./config";
import { CONDITION_LABEL, fmtInt, fmtPrice } from "./format";
import { type BarSub, useLive } from "./live";
import type {
  Account,
  Alert,
  AlertLogEntry,
  AppConfig,
  Bar,
  EngineEvent,
  Indicator,
  Layout,
  LayoutId,
  Order,
  Pane,
  Position,
  Side,
  SymbolInfo,
  Trade,
  Watchlist,
} from "./types";

type SideTab = "watchlist" | "alerts" | "screener";
type Series = { key: string; bars: Bar[] };

const TOAST_MS = 6000;
const PANES = 4;
const GRID: Record<LayoutId, string> = {
  "1": "grid-cols-1 grid-rows-1",
  "2": "grid-cols-2 grid-rows-1",
  "3": "grid-cols-3 grid-rows-1",
  "4": "grid-cols-2 grid-rows-2",
};

const paneKey = (p: Pane) => `${p.ticker}|${p.timeframe}`;
const emptySeries = (): Series[] => Array.from({ length: PANES }, () => ({ key: "", bars: [] }));

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [series, setSeries] = useState<Series[]>(emptySeries);
  const [ranges, setRanges] = useState<(RangeRequest | null)[]>([null, null, null, null]);
  const [maximized, setMaximized] = useState<number | null>(null);
  const [alertPrefill, setAlertPrefill] = useState<{ ticker: string; price: number; nonce: number } | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertLog, setAlertLog] = useState<AlertLogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prefill, setPrefill] = useState<TicketPrefill | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("watchlist");
  const [crosshair, setCrosshair] = useState(true);
  const controls = useRef<RefObject<ChartControls | null>[]>(
    Array.from({ length: PANES }, () => createRef<ChartControls | null>()),
  );
  const toastId = useRef(0);
  const barsReq = useRef<number[]>([0, 0, 0, 0]);
  const requested = useRef<string[]>(["", "", "", ""]);

  const visible = layout ? Number(layout.layout) : 1;
  const activeIdx = layout?.active_pane ?? 0;
  const activePane = layout?.panes[activeIdx];
  const active = activePane?.ticker ?? "";

  // --- data loading ----------------------------------------------------------------------

  const quiet = <T,>(p: Promise<T>, set: (v: T) => void) =>
    p.then(set).catch(() => {
      /* transient: the next tick or event refreshes it */
    });

  const refreshAccount = useCallback(() => {
    quiet(api.account(), setAccount);
    quiet(api.positions(), setPositions);
  }, []);
  const refreshOrders = useCallback(() => {
    quiet(api.orders(), setOrders);
    quiet(api.trades(), setTrades);
  }, []);
  const refreshWatchlists = useCallback(() => api.watchlists().then(setWatchlists), []);
  const refreshAlerts = useCallback(async () => {
    const [a, l] = await Promise.all([api.alerts(), api.alertLog()]);
    setAlerts(a);
    setAlertLog(l);
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const onEvent = useCallback(
    (e: EngineEvent) => {
      if (e.type === "order_filled") {
        pushToast({
          tone: "success",
          title: `Filled: ${String(e.side).toUpperCase()} ${fmtInt(Number(e.qty))} ${e.ticker}`,
          body: `@ ${fmtPrice(Number(e.price))}`,
        });
      } else if (e.type === "order_rejected") {
        pushToast({ tone: "error", title: `Order #${e.order_id} rejected`, body: String(e.reason ?? "") });
      } else if (e.type === "alert_triggered") {
        pushToast({
          tone: "alert",
          title: `Alert: ${e.ticker} ${CONDITION_LABEL[String(e.condition)] ?? e.condition} ${fmtPrice(Number(e.price))}`,
          body: `Last ${fmtPrice(Number(e.trigger_price))}${e.note ? ` · ${e.note}` : ""}`,
        });
        refreshAlerts().catch(() => {});
      } else if (e.type === "session_closed") {
        pushToast({ tone: "info", title: "Session closed", body: "Working orders were cancelled." });
      }
      refreshOrders();
      refreshAccount();
    },
    [pushToast, refreshAccount, refreshAlerts, refreshOrders],
  );

  // Live bars for every visible pane (deduplicated).
  const subs: BarSub[] = useMemo(() => {
    if (!layout) return [];
    const seen = new Set<string>();
    const out: BarSub[] = [];
    for (const p of layout.panes.slice(0, visible)) {
      if (!seen.has(paneKey(p))) {
        seen.add(paneKey(p));
        out.push({ ticker: p.ticker, tf: p.timeframe });
      }
    }
    return out;
  }, [layout, visible]);
  const live = useLive(subs, onEvent);

  // Initial load, and again whenever the server starts a new episode.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const [cfg, syms, lay] = await Promise.all([loadConfig(), api.symbols(), api.layout()]);
        if (cancelled) return;
        setConfig(cfg);
        setSymbols(syms);
        requested.current = ["", "", "", ""];
        setSeries(emptySeries());
        setMaximized(null);
        setLayout(lay);
        setNotReady(false);
        await Promise.all([refreshWatchlists(), refreshAlerts()]);
        refreshOrders();
        refreshAccount();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 503) setNotReady(true);
        retry = setTimeout(load, 2000);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [live.epoch, refreshAccount, refreshAlerts, refreshOrders, refreshWatchlists]);

  const loadBars = useCallback((pane: number, ticker: string, tf: string) => {
    const req = ++barsReq.current[pane];
    const key = `${ticker}|${tf}`;
    requested.current[pane] = key;
    api
      .bars(ticker, tf)
      .then((r) => {
        if (req !== barsReq.current[pane]) return;
        setSeries((cur) => cur.map((s, i) => (i === pane ? { key, bars: r.bars } : s)));
      })
      .catch(() => {
        requested.current[pane] = "";
      });
  }, []);

  // Fetch full series whenever a visible pane's symbol or timeframe changes.
  const visibleKeys = layout ? layout.panes.slice(0, visible).map(paneKey).join(",") : "";
  useEffect(() => {
    if (!layout) return;
    layout.panes.slice(0, visible).forEach((p, i) => {
      if (requested.current[i] !== paneKey(p)) loadBars(i, p.ticker, p.timeframe);
    });
  }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge live bar updates into every pane showing that series; reload a pane if it missed bars.
  useEffect(() => {
    if (live.bars.length === 0) return;
    const byKey = new Map(live.bars.map((lb) => [`${lb.ticker}|${lb.timeframe}`, lb]));
    // State updaters run later, so a pane that missed bars schedules its own reload.
    setSeries((cur) =>
      cur.map((s, i) => {
        const lb = byKey.get(s.key);
        if (!lb || lb.bars.length === 0 || s.bars.length === 0) return s;
        const last = s.bars[s.bars.length - 1];
        const incoming = lb.bars.filter((b) => b.time >= last.time);
        if (incoming.length === 0) return s;
        if (lb.bars[0].time > last.time) {
          const [ticker, tf] = s.key.split("|");
          queueMicrotask(() => loadBars(i, ticker, tf));
          return s;
        }
        return { key: s.key, bars: [...s.bars.filter((b) => b.time < incoming[0].time), ...incoming] };
      }),
    );
  }, [live.bars, loadBars]);

  // Account values move with prices: refresh whenever sim time advances.
  const simNow = live.clock?.sim_now;
  useEffect(() => {
    if (simNow != null && config) refreshAccount();
  }, [simNow, config, refreshAccount]);

  // --- actions (all chart actions target the active pane) ----------------------------------

  const saveLayout = useCallback(
    (optimistic: (l: Layout) => Layout, call: () => Promise<Layout>) => {
      setLayout((l) => (l ? optimistic(l) : l));
      call()
        .then(setLayout)
        .catch((e) => {
          pushToast({ tone: "error", title: "Could not update the chart", body: e instanceof ApiError ? e.message : "" });
          api.layout().then(setLayout).catch(() => {});
        });
    },
    [pushToast],
  );

  const patchPane = useCallback(
    (pane: number, changes: { ticker?: string; timeframe?: string; indicators?: Indicator[] }) =>
      saveLayout(
        (l) => ({ ...l, panes: l.panes.map((p) => (p.pane === pane ? { ...p, ...changes } : p)) }),
        () => api.updatePane(pane, changes),
      ),
    [saveLayout],
  );

  const activate = useCallback(
    (pane: number) => {
      if (!layout || layout.active_pane === pane) return;
      saveLayout((l) => ({ ...l, active_pane: pane }), () => api.setActivePane(pane));
    },
    [layout, saveLayout],
  );

  const chooseLayout = (id: LayoutId) => {
    setMaximized(null);
    saveLayout(
      (l) => ({ ...l, layout: id, active_pane: l.active_pane < Number(id) ? l.active_pane : 0 }),
      () => api.setLayout(id),
    );
  };

  const selectSymbol = useCallback((t: string) => patchPane(activeIdx, { ticker: t }), [patchPane, activeIdx]);

  const prefillTicket = (ticker: string, side: Side, qty?: number) =>
    setPrefill((p) => ({ ticker, side, qty, nonce: (p?.nonce ?? 0) + 1 }));

  const applyRange = (preset: RangePreset) => {
    if (!activePane) return;
    if (preset.tf !== activePane.timeframe) patchPane(activeIdx, { timeframe: preset.tf });
    setRanges((rs) =>
      rs.map((r, i) =>
        i === activeIdx
          ? { ticker: active, tf: preset.tf, sessions: preset.sessions, fromDate: preset.fromDate, nonce: (r?.nonce ?? 0) + 1 }
          : r,
      ),
    );
  };

  const openAlert = () => {
    setSideTab("alerts");
    setAlertPrefill((a) => ({ ticker: active, price: live.quotes[active]?.last ?? 0, nonce: (a?.nonce ?? 0) + 1 }));
  };

  // --- render ------------------------------------------------------------------------------

  if (!config || !layout || !activePane) {
    return (
      <div className="flex h-full items-center justify-center text-muted" data-testid="loading">
        {notReady ? "Waiting for the environment to start…" : "Loading…"}
      </div>
    );
  }

  const status = live.clock?.market_status;
  const closed = status === "closed";
  const tradingOpen = status === "open";
  const nameOf = (t: string) => symbols.find((s) => s.ticker === t)?.name ?? "";

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        appName={config.app_name}
        symbols={symbols}
        active={active}
        onSymbol={selectSymbol}
        timeframes={config.timeframes}
        timeframe={activePane.timeframe}
        onTimeframe={(tf) => patchPane(activeIdx, { timeframe: tf })}
        indicators={activePane.indicators}
        onIndicators={(inds) => patchPane(activeIdx, { indicators: inds })}
        clock={live.clock}
        connected={live.connected}
        onAlert={openAlert}
        layout={layout.layout}
        onLayout={chooseLayout}
      />
      <div className="flex min-h-0 flex-1">
        <LeftRail crosshair={crosshair} onCrosshair={setCrosshair} controls={controls.current[activeIdx]} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className={`grid min-h-0 flex-1 gap-px bg-line ${maximized != null ? GRID["1"] : GRID[layout.layout]}`}
            data-testid="chart-grid"
            data-layout={layout.layout}
          >
            {layout.panes.slice(0, visible).map((p, i) => {
              const isActive = i === activeIdx;
              const hidden = maximized != null && maximized !== i;
              return (
                <div
                  key={i}
                  data-testid={`pane-${i}`}
                  data-active={isActive}
                  data-ticker={p.ticker}
                  data-timeframe={p.timeframe}
                  onMouseDownCapture={() => activate(i)}
                  onFocusCapture={() => activate(i)}
                  className={`relative flex min-h-0 min-w-0 flex-col bg-bg ${hidden ? "hidden" : ""} ${
                    visible > 1 && isActive ? "outline-2 -outline-offset-2 outline-accent outline" : ""
                  }`}
                >
                  <ChartPanel
                    ticker={p.ticker}
                    name={nameOf(p.ticker)}
                    timeframe={p.timeframe}
                    indicators={p.indicators}
                    bars={series[i].key === paneKey(p) ? series[i].bars : []}
                    barsKey={series[i].key === paneKey(p) ? series[i].key : ""}
                    quote={live.quotes[p.ticker]}
                    closed={closed}
                    crosshair={crosshair}
                    controls={controls.current[i]}
                    range={ranges[i]}
                    onQuickTrade={(side) => prefillTicket(p.ticker, side)}
                  />
                  {visible > 1 && (
                    <button
                      type="button"
                      title={maximized === i ? "Restore layout" : "Maximize chart"}
                      aria-label={maximized === i ? "Restore layout" : "Maximize chart"}
                      aria-pressed={maximized === i}
                      data-testid={`pane-maximize-${i}`}
                      onClick={() => setMaximized((m) => (m === i ? null : i))}
                      className="absolute top-2 right-[78px] z-20 flex h-6 w-6 items-center justify-center rounded border border-line bg-raised text-muted hover:text-strong"
                    >
                      {maximized === i ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <RangeBar presets={rangePresets(config.session_date)} onRange={applyRange} clock={live.clock} />
          <BottomPanel
            account={account}
            positions={positions}
            orders={orders}
            trades={trades}
            tradingOpen={tradingOpen}
            onSymbol={selectSymbol}
            onClosePosition={prefillTicket}
            reload={() => {
              refreshOrders();
              refreshAccount();
            }}
          >
            <OrderTicket
              active={active}
              quotes={live.quotes}
              symbols={symbols}
              tradingOpen={tradingOpen}
              prefill={prefill}
              onPlaced={() => {
                refreshOrders();
                refreshAccount();
              }}
            />
          </BottomPanel>
        </main>
        <aside
          className={`flex shrink-0 flex-col border-l border-line bg-panel transition-[width] ${
            sideTab === "screener" ? "w-[560px]" : "w-[340px]"
          }`}
          aria-label="Sidebar"
        >
          <Tabs
            idPrefix="side"
            value={sideTab}
            onChange={setSideTab}
            tabs={[
              { id: "watchlist", label: "Watchlist" },
              {
                id: "alerts",
                label: `Alerts${alerts.some((a) => a.status === "active") ? ` (${alerts.filter((a) => a.status === "active").length})` : ""}`,
              },
              { id: "screener", label: "Screener" },
            ]}
          />
          {sideTab === "watchlist" && (
            <>
              <Watchlists
                lists={watchlists}
                quotes={live.quotes}
                symbols={symbols}
                active={active}
                onSymbol={selectSymbol}
                reload={refreshWatchlists}
              />
              <SymbolDetails quote={live.quotes[active]} clock={live.clock} />
            </>
          )}
          {sideTab === "alerts" && (
            <Alerts
              alerts={alerts}
              log={alertLog}
              symbols={symbols}
              active={active}
              closed={closed}
              prefill={alertPrefill}
              reload={refreshAlerts}
            />
          )}
          {sideTab === "screener" && <Screener quotes={live.quotes} sectors={config.sectors} onSymbol={selectSymbol} />}
        </aside>
      </div>
      <datalist id="cv-symbols">
        {symbols.map((s) => (
          <option key={s.ticker} value={s.ticker}>
            {s.name}
          </option>
        ))}
      </datalist>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  );
}
