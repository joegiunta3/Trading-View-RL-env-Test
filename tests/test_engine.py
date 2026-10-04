"""Order engine: fills, prices, timing, accounting and every rejection rule."""

from app.config import START_CASH_CENTS
from app.timeutil import cents_to_usd
from tests.conftest import advance_to, make_episode, order, px, quote_at, raises_engine

T = "AAPL"


def first_second(cond, start: int, end: int) -> int:
    for s in range(start, end):
        if cond(s):
            return s
    raise AssertionError("condition never met in window")


# --- market orders -------------------------------------------------------------------------


def test_market_buy_fills_at_ask_now(ep):
    advance_to(ep, 1234)
    bid, ask = quote_at(ep, T, 1234)
    o = order(ep, T, "buy", "market", 10)
    assert o["status"] == "filled" and o["filled_sim_ts"] == 1234
    assert o["fill_price"] == cents_to_usd(ask)
    acct = ep.account_summary()
    assert acct["cash"] == cents_to_usd(START_CASH_CENTS - 10 * ask)
    [pos] = ep.positions()
    assert pos["ticker"] == T and pos["qty"] == 10 and pos["avg_price"] == cents_to_usd(ask)
    [trade] = ep.trades()
    assert trade["order_id"] == o["id"] and trade["sim_ts"] == 1234


def test_market_sell_fills_at_bid_and_realizes_pnl():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 20, "avg_price": 100.00}]})
    advance_to(e, 500)
    bid, _ = quote_at(e, T, 500)
    o = order(e, T, "sell", "market", 20)
    assert o["fill_price"] == cents_to_usd(bid)
    acct = e.account_summary()
    assert acct["realized_pnl"] == cents_to_usd(20 * bid - 20 * 10000)
    assert acct["cash"] == cents_to_usd(START_CASH_CENTS + 20 * bid)
    assert e.positions() == []


def test_partial_sell_keeps_average_cost():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 30, "avg_price": 50.00}]})
    order(e, T, "sell", "market", 10)
    [pos] = e.positions()
    assert pos["qty"] == 20 and pos["avg_price"] == 50.00


# --- limit orders --------------------------------------------------------------------------


def test_limit_buy_rests_then_fills_at_first_touch(ep):
    sid = ep.world.by_ticker[T].id
    asks = {s: ep.market.bid_ask(sid, s)[1] for s in range(1, 3601)}
    limit = sorted(asks.values())[len(asks) // 10]  # touched, but not immediately
    _, ask0 = quote_at(ep, T, 0)
    assert ask0 > limit
    o = order(ep, T, "buy", "limit", 5, limit_price=cents_to_usd(limit))
    assert o["status"] == "working"
    hit = first_second(lambda s: asks[s] <= limit, 1, 3601)
    advance_to(ep, hit - 1)
    assert ep.list_orders()[0]["status"] == "working"
    ep.advance(1)
    filled = ep.list_orders()[0]
    assert filled["status"] == "filled" and filled["filled_sim_ts"] == hit
    assert filled["fill_price"] == cents_to_usd(asks[hit]) <= cents_to_usd(limit)


def test_limit_sell_fills_when_bid_reaches_limit():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 5, "avg_price": 1.00}]})
    sid = e.world.by_ticker[T].id
    bids = {s: e.market.bid_ask(sid, s)[0] for s in range(1, 3601)}
    limit = sorted(bids.values())[-len(bids) // 10]
    o = order(e, T, "sell", "limit", 5, limit_price=cents_to_usd(limit))
    assert o["status"] == "working"
    hit = first_second(lambda s: bids[s] >= limit, 1, 3601)
    advance_to(e, 3600)
    filled = e.list_orders()[0]
    assert filled["filled_sim_ts"] == hit and filled["fill_price"] == cents_to_usd(bids[hit])


def test_marketable_limit_fills_immediately_at_quote(ep):
    _, ask = quote_at(ep, T, 0)
    o = order(ep, T, "buy", "limit", 3, limit_price=cents_to_usd(ask + 500))
    assert o["status"] == "filled" and o["filled_sim_ts"] == 0
    assert o["fill_price"] == cents_to_usd(ask)


# --- stop orders ---------------------------------------------------------------------------


def test_sell_stop_triggers_on_touch_and_fills_next_second():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 10, "avg_price": 1.00}]})
    window = range(1, 5401)
    stop = sorted(px(e, T, s) for s in window)[len(window) // 10]
    assert stop < px(e, T, 0)
    o = order(e, T, "sell", "stop", 10, stop_price=cents_to_usd(stop))
    trig = first_second(lambda s: px(e, T, s) <= stop, 1, 5401)
    advance_to(e, trig)
    cur = e.list_orders()[0]
    assert cur["status"] == "working" and cur["triggered_sim_ts"] == trig
    e.advance(1)
    cur = e.list_orders()[0]
    bid, _ = quote_at(e, T, trig + 1)
    assert cur["status"] == "filled" and cur["filled_sim_ts"] == trig + 1
    assert cur["fill_price"] == cents_to_usd(bid)
    assert o["id"] == cur["id"]


def test_buy_stop_triggers_on_rise(ep):
    window = range(1, 5401)
    stop = sorted(px(ep, T, s) for s in window)[-len(window) // 10]
    order(ep, T, "buy", "stop", 2, stop_price=cents_to_usd(stop))
    trig = first_second(lambda s: px(ep, T, s) >= stop, 1, 5401)
    advance_to(ep, trig + 1)
    cur = ep.list_orders()[0]
    _, ask = quote_at(ep, T, trig + 1)
    assert cur["triggered_sim_ts"] == trig and cur["fill_price"] == cents_to_usd(ask)


def test_stop_on_wrong_side_rejected(ep):
    last = cents_to_usd(px(ep, T, 0))
    o = order(ep, T, "buy", "stop", 1, stop_price=round(last - 1, 2))
    assert o["status"] == "rejected" and "above the last price" in o["reason"]


# --- shorts and buying power ---------------------------------------------------------------


def test_short_locks_collateral_and_cover_realizes_pnl(ep):
    bid0, _ = quote_at(ep, T, 0)
    order(ep, T, "short", "market", 100)
    acct = ep.account_summary()
    assert acct["cash"] == cents_to_usd(START_CASH_CENTS)  # proceeds not credited
    assert acct["short_collateral"] == cents_to_usd(100 * bid0)
    assert acct["buying_power"] == cents_to_usd(START_CASH_CENTS - 100 * bid0)
    [pos] = ep.positions()
    assert pos["qty"] == -100 and pos["side"] == "short"
    advance_to(ep, 3000)
    _, ask = quote_at(ep, T, 3000)
    o = order(ep, T, "cover", "market", 100)
    assert o["fill_price"] == cents_to_usd(ask)
    pnl = 100 * bid0 - 100 * ask
    acct = ep.account_summary()
    assert acct["realized_pnl"] == cents_to_usd(pnl)
    assert acct["cash"] == cents_to_usd(START_CASH_CENTS + pnl)
    assert acct["short_collateral"] == 0 and ep.positions() == []


def test_working_buy_reserves_buying_power(ep):
    o = order(ep, T, "buy", "limit", 90_000, limit_price=1.00)
    assert o["status"] == "working"
    acct = ep.account_summary()
    assert acct["reserved_for_orders"] == 90000.00
    assert acct["buying_power"] == 10000.00
    r = order(ep, "MSFT", "buy", "limit", 10_001, limit_price=1.00)
    assert r["status"] == "rejected" and "Insufficient buying power" in r["reason"]
    ep.cancel_order(o["id"])
    assert ep.account_summary()["buying_power"] == 100000.00


def test_short_rejected_beyond_buying_power(ep):
    bid, _ = quote_at(ep, T, 0)
    qty = START_CASH_CENTS // bid + 1
    r = order(ep, T, "short", "market", qty)
    assert r["status"] == "rejected" and "Insufficient buying power" in r["reason"]


# --- rejections ----------------------------------------------------------------------------


def test_quantity_rejections(ep):
    for q in (0, -5):
        r = order(ep, T, "buy", "market", q)
        assert r["status"] == "rejected" and "positive whole number" in r["reason"]
    raises_engine(order, ep, T, "buy", "market", 1.5, status=422)


def test_insufficient_buying_power_market(ep):
    r = order(ep, T, "buy", "market", 1_000_000)
    assert r["status"] == "rejected" and r["reason"].startswith("Insufficient buying power")
    assert ep.positions() == []


def test_sell_more_than_held():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 10, "avg_price": 1.00}]})
    r = order(e, T, "sell", "market", 11)
    assert r["status"] == "rejected" and "only 10 shares available" in r["reason"]
    r = order(e, "MSFT", "sell", "market", 1)
    assert r["status"] == "rejected" and "only 0 shares" in r["reason"]


def test_working_sells_reserve_shares():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 10, "avg_price": 1.00}]})
    assert order(e, T, "sell", "limit", 10, limit_price=99999.00)["status"] == "working"
    r = order(e, T, "sell", "market", 1)
    assert r["status"] == "rejected" and "only 0 shares" in r["reason"]


def test_side_conflicts():
    e = make_episode(setup={"positions": [{"ticker": T, "qty": 10, "avg_price": 1.00}]})
    r = order(e, T, "short", "market", 1)
    assert r["status"] == "rejected" and "Sell it before shorting" in r["reason"]
    order(e, "MSFT", "short", "market", 5)
    r = order(e, "MSFT", "buy", "market", 1)
    assert r["status"] == "rejected" and "Use Cover" in r["reason"]
    r = order(e, "MSFT", "cover", "market", 6)
    assert r["status"] == "rejected" and "only 5 shares available to cover" in r["reason"]
    r = order(e, "NVDA", "cover", "market", 1)
    assert r["status"] == "rejected"


def test_duplicate_within_5_seconds_rejected_then_allowed(ep):
    assert order(ep, T, "buy", "market", 1)["status"] == "filled"
    ep.advance(5)
    r = order(ep, T, "buy", "market", 1)
    assert r["status"] == "rejected" and "Duplicate order" in r["reason"]
    assert order(ep, T, "buy", "market", 2)["status"] == "filled"  # not identical
    ep.advance(1)
    assert order(ep, T, "buy", "market", 1)["status"] == "filled"  # 6 s later


def test_rejected_order_does_not_count_as_duplicate(ep):
    assert order(ep, T, "buy", "market", 10**7)["status"] == "rejected"
    assert order(ep, T, "buy", "market", 10**7)["reason"].startswith("Insufficient")


def test_limit_and_stop_need_prices(ep):
    assert "need a limit price" in order(ep, T, "buy", "limit", 1)["reason"]
    assert "need a stop price" in order(ep, T, "sell", "stop", 1)["reason"]
    raises_engine(order, ep, T, "buy", "limit", 1, limit_price=1.234, status=422, match="2 decimal")
    raises_engine(order, ep, "ZZZZ", "buy", "market", 1, status=404, match="Unknown symbol")


def test_fill_time_recheck_rejects_flip():
    """A working short limit cannot fill once the account has gone long the same ticker."""
    e = make_episode()
    sid = e.world.by_ticker[T].id
    bids = {s: e.market.bid_ask(sid, s)[0] for s in range(1, 3601)}
    limit = sorted(bids.values())[-len(bids) // 10]
    o = order(e, T, "short", "limit", 5, limit_price=cents_to_usd(limit))
    assert o["status"] == "working"
    order(e, T, "buy", "market", 1)
    advance_to(e, 3600)
    cur = next(x for x in e.list_orders() if x["id"] == o["id"])
    assert cur["status"] == "rejected" and cur["reason"].startswith("Rejected at fill")


# --- cancel and logging --------------------------------------------------------------------


def test_cancel_rules(ep):
    o = order(ep, T, "buy", "limit", 1, limit_price=1.00)
    assert ep.cancel_order(o["id"])["status"] == "cancelled"
    raises_engine(ep.cancel_order, o["id"], status=409)
    raises_engine(ep.cancel_order, 999, status=404)


def test_action_log_records_orders_fills_and_failures(ep):
    advance_to(ep, 42)
    order(ep, T, "buy", "market", 1)
    raises_engine(order, ep, "ZZZZ", "buy", "market", 1)
    o = order(ep, T, "buy", "limit", 1, limit_price=1.00)
    ep.cancel_order(o["id"])
    log = ep.trace()
    eps = [(a["endpoint"], a["sim_ts"]) for a in log]
    assert ("POST /api/orders", 42) in eps
    assert ("engine:order_filled", 42) in eps
    assert ("DELETE /api/orders", 42) in eps
    assert any("error" in a["payload"] for a in log if a["endpoint"] == "POST /api/orders")
