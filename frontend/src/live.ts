import { useEffect, useRef, useState } from "react";
import type { Bar, Clock, EngineEvent, Quote } from "./types";

export type BarSub = { ticker: string; tf: string };
export type LiveBars = { ticker: string; timeframe: string; bars: Bar[] };

type Frame =
  | { type: "tick"; clock: Clock; quotes: Quote[]; bars?: LiveBars[] }
  | { type: "event"; event: EngineEvent }
  | { type: "reset" };

export type LiveState = {
  connected: boolean;
  clock: Clock | null;
  quotes: Record<string, Quote>;
  /** Newest bars for each subscribed (ticker, timeframe). */
  bars: LiveBars[];
  /** Increments when the server starts a new episode, so views reload everything. */
  epoch: number;
};

/**
 * Server push stream. The server sends one tick per real second with the sim clock, all
 * quotes and the latest bars of each subscribed chart (up to 4 panes), plus engine events
 * (fills, alerts). The browser never computes time itself.
 */
export function useLive(subs: BarSub[], onEvent: (e: EngineEvent) => void): LiveState {
  const [state, setState] = useState<LiveState>({ connected: false, clock: null, quotes: {}, bars: [], epoch: 0 });
  const socketRef = useRef<WebSocket | null>(null);
  const subsRef = useRef(subs);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  subsRef.current = subs;

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        ws.send(JSON.stringify({ subscribe: subsRef.current }));
      };
      ws.onmessage = (msg) => {
        const frame = JSON.parse(msg.data) as Frame;
        if (frame.type === "tick") {
          const quotes: Record<string, Quote> = {};
          for (const q of frame.quotes) quotes[q.ticker] = q;
          setState((s) => ({ ...s, clock: frame.clock, quotes, bars: frame.bars ?? [] }));
        } else if (frame.type === "event") {
          onEventRef.current(frame.event);
        } else if (frame.type === "reset") {
          setState((s) => ({ ...s, bars: [], epoch: s.epoch + 1 }));
        }
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  const subsKey = subs.map((s) => `${s.ticker}|${s.tf}`).join(",");
  useEffect(() => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ subscribe: subsRef.current }));
  }, [subsKey]);

  return state;
}
