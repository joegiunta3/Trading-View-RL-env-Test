"""Chart drawings: validation, per-symbol storage, info-line stats, logging, state."""

from tests.conftest import raises_engine

T0 = 1768467600  # Jan 15 09:00 bar label (UTC-labelled epoch)


def test_create_info_line_with_stats_and_labels(ep):
    d = ep.create_drawing(
        "aapl", "info_line", [{"time": T0, "price": 100.0}, {"time": T0 + 7200, "price": 100.15}]
    )
    assert d["ticker"] == "AAPL" and d["label"] == "Info line"
    assert [p["label"] for p in d["points"]] == ["Jan 15 09:00", "Jan 15 11:00"]
    assert d["stats"] == {
        "price_change": 0.15,
        "pct_change": 0.15,
        "change_cents": 15,
        "time_span_seconds": 7200,
    }


def test_point_counts_and_validation(ep):
    ep.create_drawing("MSFT", "horizontal_line", [{"time": T0, "price": 50.5}])
    ep.create_drawing("MSFT", "vertical_line", [{"time": T0 + 60, "price": 50.5}])
    raises_engine(ep.create_drawing, "MSFT", "trendline", [{"time": T0, "price": 1.0}], status=422)
    raises_engine(ep.create_drawing, "MSFT", "circle", [{"time": T0, "price": 1.0}], status=422)
    raises_engine(
        ep.create_drawing, "MSFT", "horizontal_line", [{"time": T0, "price": 0}], status=422
    )
    raises_engine(
        ep.create_drawing, "MSFT", "horizontal_line", [{"time": 5, "price": 1.0}], status=422
    )
    raises_engine(
        ep.create_drawing, "ZZZZ", "horizontal_line", [{"time": T0, "price": 1.0}], status=404
    )


def test_drawings_are_per_symbol_and_editable(ep):
    a = ep.create_drawing(
        "AAPL", "trendline", [{"time": T0, "price": 1.0}, {"time": T0 + 60, "price": 2.0}]
    )
    ep.create_drawing("XOM", "horizontal_line", [{"time": T0, "price": 3.0}])
    assert [d["ticker"] for d in ep.list_drawings("AAPL")] == ["AAPL"]
    assert len(ep.list_drawings()) == 2
    ep.advance(30)
    moved = ep.move_drawing(a["id"], [{"time": T0, "price": 1.5}, {"time": T0 + 120, "price": 2.5}])
    assert moved["points"][0]["price"] == 1.5 and moved["updated_sim_ts"] == 30
    ep.delete_drawing(a["id"])
    raises_engine(ep.delete_drawing, a["id"], status=404)
    assert ep.delete_symbol_drawings("XOM") == 1 and ep.list_drawings() == []


def test_drawing_actions_are_logged_and_in_state(ep):
    d = ep.create_drawing("GS", "horizontal_line", [{"time": T0, "price": 120.0}])
    ep.move_drawing(d["id"], [{"time": T0, "price": 121.0}])
    endpoints = [a["endpoint"] for a in ep.trace()]
    assert endpoints.count("POST /api/drawings") == 1 and "PATCH /api/drawings" in endpoints
    rows = ep.state()["tables"]["drawings"]
    assert len(rows) == 1 and '"price":12100' in rows[0]["points_json"]
