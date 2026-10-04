import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { BottomPanel } from "./components/BottomPanel";
import { type ChartControls, ChartPanel, type RangeRequest } from "./components/ChartPanel";
import { Alerts } from "./components/Alerts";
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
import { useLive } from "./live";
import type {
  Account,
  Alert,
  AlertLogEntry,
  AppConfig,
  Bar,
  EngineEvent,
  Indicator,
  Order,
  Position,
  Side,
  SymbolInfo,
  Trade,
  Watchlist,
} from "./types";

type SideTab = "watchlist" | "alerts" | "screener";
type Prefs = { timeframe: string; indicators: Indicator[] };

const TOAST_MS = 6000;

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [active, setActive] = useState("");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [series, setSeries] = useState<{ key: string; bars: Bar[] }>({ key: "", bars: [] });
  const [range, setRange] = useState<RangeRequest | null>(null);
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
  const controls = useRef<ChartControls | null>(null);
  const toastId = useRef(0);
  const barsReq = useRef(0);

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

  const sub = useMemo(() => (active && prefs ? { ticker: active, tf: prefs.timeframe } : null), [active, prefs]);
  const live = useLive(sub, onEvent);

  // Initial load, and again whenever the server starts a new episode.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const [cfg, syms, ui] = await Promise.all([loadConfig(), api.symbols(), api.uiState()]);
        if (cancelled) return;
        setConfig(cfg);
        setSymbols(syms);
        setActive(ui.active_symbol ?? syms[0]?.ticker ?? "");
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

  // Chart preferences for the active symbol.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api
      .chartPrefs(active)
      .then((p) => !cancelled && setPrefs({ timeframe: p.timeframe, indicators: p.indicators }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, live.epoch]);

  const loadBars = useCallback((ticker: string, tf: string) => {
    const req = ++barsReq.current;
    api
      .bars(ticker, tf)
      .then((r) => req === barsReq.current && setSeries({ key: `${ticker}|${tf}`, bars: r.bars }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (active && prefs) loadBars(active, prefs.timeframe);
  }, [active, prefs?.timeframe, loadBars]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge live bar updates into the loaded series; reload if any bar was skipped.
  useEffect(() => {
    const lb = live.bars;
    if (!lb || lb.bars.length === 0) return;
    const key = `${lb.ticker}|${lb.timeframe}`;
    setSeries((cur) => {
      const prev = cur.bars;
      if (cur.key !== key || prev.length === 0) return cur;
      const last = prev[prev.length - 1];
      const incoming = lb.bars.filter((b) => b.time >= last.time);
      if (incoming.length === 0) return cur;
      if (lb.bars[0].time > last.time) {
        loadBars(lb.ticker, lb.timeframe); // missed bars: fetch the full series
        return cur;
      }
      return { key, bars: [...prev.filter((b) => b.time < incoming[0].time), ...incoming] };
    });
  }, [live.bars]); // eslint-disable-line react-hooks/exhaustive-deps

  // Account values move with prices: refresh whenever sim time advances.
  const simNow = live.clock?.sim_now;
  useEffect(() => {
    if (simNow != null && config) refreshAccount();
  }, [simNow, config, refreshAccount]);

  // --- actions ---------------------------------------------------------------------------

  const selectSymbol = useCallback((t: string) => {
    setActive(t);
    api.setActiveSymbol(t).catch(() => {});
  }, []);

  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    api.saveChartPrefs(active, next.timeframe, next.indicators).catch((e) =>
      pushToast({ tone: "error", title: "Could not save chart settings", body: e instanceof ApiError ? e.message : "" }),
    );
  };

  const closePosition = (ticker: string, side: Side, qty?: number) =>
    setPrefill((p) => ({ ticker, side, qty, nonce: (p?.nonce ?? 0) + 1 }));

  const applyRange = (preset: RangePreset) => {
    if (!prefs) return;
    if (preset.tf !== prefs.timeframe) savePrefs({ ...prefs, timeframe: preset.tf });
    setRange((r) => ({
      ticker: active,
      tf: preset.tf,
      sessions: preset.sessions,
      fromDate: preset.fromDate,
      nonce: (r?.nonce ?? 0) + 1,
    }));
  };

  const openAlert = () => {
    setSideTab("alerts");
    setAlertPrefill((a) => ({ ticker: active, price: live.quotes[active]?.last ?? 0, nonce: (a?.nonce ?? 0) + 1 }));
  };

  // --- render ------------------------------------------------------------------------------

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-muted" data-testid="loading">
        {notReady ? "Waiting for the environment to start…" : "Loading…"}
      </div>
    );
  }

  const status = live.clock?.market_status;
  const closed = status === "closed";
  const tradingOpen = status === "open";
  const activeInfo = symbols.find((s) => s.ticker === active);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        appName={config.app_name}
        symbols={symbols}
        active={active}
        onSymbol={selectSymbol}
        timeframes={config.timeframes}
        timeframe={prefs?.timeframe ?? ""}
        onTimeframe={(tf) => prefs && savePrefs({ ...prefs, timeframe: tf })}
        indicators={prefs?.indicators ?? []}
        onIndicators={(inds) => prefs && savePrefs({ ...prefs, indicators: inds })}
        clock={live.clock}
        connected={live.connected}
        onAlert={openAlert}
      />
      <div className="flex min-h-0 flex-1">
        <LeftRail crosshair={crosshair} onCrosshair={setCrosshair} controls={controls} />
        <main className="flex min-w-0 flex-1 flex-col">
          <ChartPanel
            ticker={active}
            name={activeInfo?.name ?? ""}
            timeframe={prefs?.timeframe ?? ""}
            indicators={prefs?.indicators ?? []}
            bars={series.bars}
            barsKey={series.key}
            quote={live.quotes[active]}
            closed={closed}
            crosshair={crosshair}
            controls={controls}
            range={range}
            onQuickTrade={(side) => closePosition(active, side)}
          />
          <RangeBar presets={rangePresets(config.session_date)} onRange={applyRange} clock={live.clock} />
          <BottomPanel
            account={account}
            positions={positions}
            orders={orders}
            trades={trades}
            tradingOpen={tradingOpen}
            onSymbol={selectSymbol}
            onClosePosition={closePosition}
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
              { id: "alerts", label: `Alerts${alerts.some((a) => a.status === "active") ? ` (${alerts.filter((a) => a.status === "active").length})` : ""}` },
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
