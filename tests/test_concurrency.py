"""The public app, the WebSocket pusher and the ticker share one Episode from many threads."""

import threading

from tests.conftest import make_episode, order


def test_concurrent_reads_and_writes_do_not_corrupt_queries():
    e = make_episode(setup={"positions": [{"ticker": "KO", "qty": 10, "avg_price": 50.0}]})
    errors: list[BaseException] = []
    stop = threading.Event()

    def reader():
        try:
            while not stop.is_set():
                assert e.positions()[0]["ticker"] in {"KO", "AAPL"}
                e.account_summary()
                e.list_orders()
                e.watchlists()
                e.list_alerts()
                e.quotes()
        except BaseException as exc:  # noqa: BLE001 - surface any failure from the thread
            errors.append(exc)

    threads = [threading.Thread(target=reader) for _ in range(4)]
    for t in threads:
        t.start()
    try:
        for i in range(150):
            order(e, "AAPL", "buy", "limit", 1, limit_price=1.00 + i / 100)
            e.create_alert("MSFT", "above", 9999.0 + i)
            e.advance(7)
    finally:
        stop.set()
        for t in threads:
            t.join()
    assert errors == []
