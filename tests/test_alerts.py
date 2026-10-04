"""Alerts fire on the path price at the first qualifying second after creation, once."""

import pytest

from app.timeutil import cents_to_usd
from tests.conftest import advance_to, px, raises_engine

T = "MSFT"
WINDOW = 5400


def expected(e, cond: str, level: int, created: int) -> int | None:
    for s in range(created + 1, created + WINDOW + 1):
        p, prev = px(e, T, s), px(e, T, s - 1)
        hit = {
            "above": p >= level,
            "below": p <= level,
            "crossing_up": prev < level <= p,
            "crossing_down": prev > level >= p,
        }[cond]
        if hit:
            return s
    return None


def level_for(e, cond: str) -> int:
    seg = sorted(px(e, T, s) for s in range(1, WINDOW))
    return seg[-len(seg) // 8] if cond in ("above", "crossing_up") else seg[len(seg) // 8]


@pytest.mark.parametrize("cond", ["above", "below", "crossing_up", "crossing_down"])
def test_alert_fires_at_first_qualifying_second(ep, cond):
    level = level_for(ep, cond)
    a = ep.create_alert(T, cond, cents_to_usd(level), note="watch")
    want = expected(ep, cond, level, 0)
    assert want is not None
    advance_to(ep, want - 1)
    assert ep.list_alerts()[0]["triggered_sim_ts"] is None
    ep.advance(1)
    [cur] = ep.list_alerts()
    assert cur["triggered_sim_ts"] == want and cur["status"] == "triggered"
    [log] = ep.alert_log()
    assert log["alert_id"] == a["id"] and log["sim_ts"] == want
    assert log["trigger_price"] == cents_to_usd(px(ep, T, want))
    events = [ev for ev in ep.events_since(0) if ev["type"] == "alert_triggered"]
    assert events[0]["sim_ts"] == want and events[0]["note"] == "watch"
    assert ("engine:alert_triggered", want) in [(x["endpoint"], x["sim_ts"]) for x in ep.trace()]
    ep.advance(WINDOW)
    assert len(ep.alert_log()) == 1  # fires once


def test_disabled_alert_never_fires_and_reenable_rearms(ep):
    level = level_for(ep, "above")
    a = ep.create_alert(T, "above", cents_to_usd(level))
    ep.update_alert(a["id"], {"enabled": False})
    ep.advance(WINDOW)
    assert ep.alert_log() == [] and ep.list_alerts()[0]["status"] == "disabled"
    ep.update_alert(a["id"], {"enabled": True, "price": 0.01})
    ep.advance(1)
    assert ep.list_alerts()[0]["triggered_sim_ts"] == ep.now


def test_editing_price_resets_trigger(ep):
    a = ep.create_alert(T, "above", 0.01)
    ep.advance(1)
    assert ep.list_alerts()[0]["triggered_sim_ts"] == 1
    ep.update_alert(a["id"], {"note": "only a note"})
    assert ep.list_alerts()[0]["triggered_sim_ts"] == 1  # note-only edit does not re-arm
    ep.update_alert(a["id"], {"price": 0.02})
    assert ep.list_alerts()[0]["triggered_sim_ts"] is None
    ep.advance(1)
    assert len(ep.alert_log()) == 2


def test_alert_validation_and_delete(ep):
    raises_engine(ep.create_alert, T, "sideways", 10.0, status=422)
    raises_engine(ep.create_alert, T, "above", -1.0, status=422)
    raises_engine(ep.create_alert, "NOPE", "above", 1.0, status=404)
    a = ep.create_alert(T, "below", 1.0)
    ep.delete_alert(a["id"])
    assert ep.list_alerts() == []
    raises_engine(ep.delete_alert, a["id"], status=404)
