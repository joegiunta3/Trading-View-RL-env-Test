"""Built-in strategies and their backtest. The UI's Strategy Tester, graders and task writers all
use this one implementation (GET /api/panes/{i}/backtest, POST /_env/backtest).

Rules:
- Signals are evaluated at each **closed** bar's close; the order fills at the **next bar's open**.
  A signal on the last closed bar with no next bar yet stays pending (nothing is filled).
- Fixed size of `qty` shares, starting capital $100,000, no commission. Backtest only: the paper
  account is never touched.
- direction "both": an opposite signal closes and reverses; "long"/"short": only that side is
  traded and the opposite signal just closes it.
"""

from collections.abc import Sequence

from app.indicators import rsi, sma

INITIAL_CAPITAL = 100_000.0
STRATEGY_NAMES = {"ma_cross": "MA Crossover", "rsi_reversal": "RSI Reversal"}
DIRECTIONS = ("both", "long", "short")

Bars = Sequence[dict]


def signals(bars: Bars, n_closed: int, cfg: dict) -> list[int]:
    """+1 (long signal), -1 (short signal) or 0 for each closed bar index (< n_closed)."""
    out = [0] * n_closed
    if cfg["type"] == "ma_cross":
        closes = [b["c"] for b in bars[:n_closed]]
        fast, slow = sma(closes, cfg["fast"]), sma(closes, cfg["slow"])
        for i in range(1, n_closed):
            a0, b0, a1, b1 = fast[i - 1], slow[i - 1], fast[i], slow[i]
            if None in (a0, b0, a1, b1):
                continue
            if a0 <= b0 and a1 > b1:
                out[i] = 1
            elif a0 >= b0 and a1 < b1:
                out[i] = -1
    elif cfg["type"] == "rsi_reversal":
        r = rsi(bars[:n_closed], cfg["period"])
        lo, hi = cfg["oversold"], cfg["overbought"]
        for i in range(1, n_closed):
            if r[i - 1] is None or r[i] is None:
                continue
            if r[i - 1] < lo <= r[i]:
                out[i] = 1
            elif r[i - 1] > hi >= r[i]:
                out[i] = -1
    else:
        raise ValueError(f"Unknown strategy {cfg['type']!r}")
    return out


def _when(bar: dict) -> str:
    """'Jan 14, 2026, 10:05' (or just the date for daily bars)."""
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    y, m, d = bar["date"].split("-")
    day = f"{months[int(m) - 1]} {int(d)}, {y}"
    return day if bar["label"] == bar["date"] else f"{day}, {bar['label']}"


def backtest(bars: Bars, n_closed: int, cfg: dict) -> dict:
    """Run `cfg` over `bars` (only the first `n_closed` are complete). Returns trades, stats,
    the equity curve and chart markers. Prices are dollars rounded to cents."""
    sig = signals(bars, n_closed, cfg)
    qty, direction = cfg["qty"], cfg["direction"]
    trades: list[dict] = []
    pos = 0  # +1 long, -1 short, 0 flat
    entry: dict | None = None
    realized = 0.0

    def close_trade(i: int) -> None:
        nonlocal realized, entry, pos
        price = bars[i]["o"]
        pnl = round((price - entry["price"]) * qty * pos, 2)
        realized += pnl
        trades[-1] |= {
            "exit_time": bars[i]["time"],
            "exit_when": _when(bars[i]),
            "exit_price": price,
            "exit_index": i,
            "pnl": pnl,
            "return_pct": round(pnl / (entry["price"] * qty) * 100, 2),
            "open": False,
        }
        pos, entry = 0, None

    def open_trade(i: int, side: int) -> None:
        nonlocal entry, pos
        price = bars[i]["o"]
        pos, entry = side, {"price": price}
        trades.append(
            {
                "number": len(trades) + 1,
                "side": "long" if side > 0 else "short",
                "qty": qty,
                "entry_time": bars[i]["time"],
                "entry_when": _when(bars[i]),
                "entry_price": price,
                "entry_index": i,
                "notional": round(price * qty, 2),
                "open": True,
            }
        )

    equity: list[dict] = []
    for i in range(1, len(bars)):
        s = sig[i - 1] if i - 1 < n_closed else 0  # fill yesterday's signal at this bar's open
        if s:
            allowed = {"both": (1, -1), "long": (1,), "short": (-1,)}[direction]
            if pos == -s:
                close_trade(i)
            if pos == 0 and s in allowed:
                open_trade(i, s)
        if i < n_closed:
            unreal = (bars[i]["c"] - entry["price"]) * qty * pos if entry else 0.0
            equity.append({"time": bars[i]["time"], "pnl": round(realized + unreal, 2)})

    last = bars[n_closed - 1] if n_closed else None
    if trades and trades[-1]["open"] and last is not None:
        t = trades[-1]
        mark = last["c"]
        pnl = round((mark - t["entry_price"]) * qty * (1 if t["side"] == "long" else -1), 2)
        t |= {
            "pnl": pnl,
            "return_pct": round(pnl / (t["entry_price"] * qty) * 100, 2),
            "mark_price": mark,
        }

    closed = [t for t in trades if not t["open"]]
    wins = [t["pnl"] for t in closed if t["pnl"] > 0]
    losses = [t["pnl"] for t in closed if t["pnl"] < 0]
    total = round(sum(t["pnl"] for t in closed), 2)
    peak = dd = dd_pct = 0.0
    for e in equity:
        eq = INITIAL_CAPITAL + e["pnl"]
        peak = max(peak, eq)
        if peak - eq > dd:
            dd, dd_pct = peak - eq, (peak - eq) / peak * 100
    first_close = bars[0]["c"] if bars else 0.0
    bh_pct = ((last["c"] - first_close) / first_close * 100) if last and first_close else 0.0
    stats = {
        "total_pnl": total,
        "total_pnl_pct": round(total / INITIAL_CAPITAL * 100, 2),
        "max_drawdown": round(dd, 2),
        "max_drawdown_pct": round(dd_pct, 2),
        "total_trades": len(closed),
        "winning_trades": len(wins),
        "percent_profitable": round(len(wins) / len(closed) * 100, 2) if closed else 0.0,
        "profit_factor": round(sum(wins) / -sum(losses), 3) if losses else None,
        "avg_trade": round(total / len(closed), 2) if closed else 0.0,
        "largest_win": max(wins, default=0.0),
        "largest_loss": min(losses, default=0.0),
        "open_pnl": trades[-1]["pnl"] if trades and trades[-1]["open"] else 0.0,
        "buy_hold_pct": round(bh_pct, 2),
        "buy_hold_pnl": round(INITIAL_CAPITAL * bh_pct / 100, 2),
    }
    if first_close:  # buy-and-hold comparison: initial capital invested at the first close
        closes = {b["time"]: b["c"] for b in bars[:n_closed]}
        for e in equity:
            e["buy_hold"] = round(
                INITIAL_CAPITAL * (closes[e["time"]] - first_close) / first_close, 2
            )
    return {
        "strategy": cfg,
        "name": STRATEGY_NAMES[cfg["type"]],
        "initial_capital": INITIAL_CAPITAL,
        "range": {
            "from": _when(bars[0]) if bars else None,
            "to": _when(bars[n_closed - 1]) if n_closed else None,
        },
        "bars_tested": n_closed,
        "trades": trades,
        "stats": stats,
        "equity": equity,
    }
