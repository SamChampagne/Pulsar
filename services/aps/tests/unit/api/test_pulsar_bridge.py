"""Real HTTP adapter and real solvers, with no standalone database or demo identity."""

from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.error_handlers import register_error_handlers
from planiadvance_v2.api.routes import pulsar


def payload(duration=60):
    return {
        "bridge_version": "pulsar.aps.v1",
        "time_zone": "UTC",
        "horizon_start": "2026-01-05T00:00:00",
        "horizon_days": 7,
        "strategy": "greedy",
        "snapshot": {
            "contract_version": "aps.canonical.v1",
            "exported_at": "2026-01-05T00:00:00",
            "source_system": "pulsar-manufacturing",
            "calendars": [
                {
                    "id": "cal",
                    "name": "Week",
                    "shifts": [{"weekday": d, "start": "08:00", "end": "17:00"} for d in range(5)],
                }
            ],
            "machines": [{"id": "m", "name": "Cutter", "calendar_id": "cal"}],
            "work_orders": [
                {
                    "id": "wo",
                    "name": "Order",
                    "product_id": "p",
                    "quantity": 1,
                    "release_date": "2026-01-05T08:00:00",
                    "due_date": "2026-01-09T17:00:00",
                    "operations": [
                        {
                            "id": "op",
                            "work_order_id": "wo",
                            "sequence": 1,
                            "name": "Cut",
                            "duration_minutes": duration,
                            "eligible_machine_ids": ["m"],
                        }
                    ],
                }
            ],
        },
    }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(
        pulsar, "get_settings", lambda: SimpleNamespace(integration_api_key="test-service-key")
    )
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(pulsar.router)
    return TestClient(app)


def headers(tenant="tenant-a"):
    return {"X-API-Key": "test-service-key", "X-Pulsar-Tenant": tenant}


def test_dated_material_supply_delays_scheduling_without_turning_into_on_hand(client):
    data = payload()
    data["snapshot"]["inventory_items"] = [{"material_id": "steel", "quantity_on_hand": 1}]
    data["snapshot"]["supplies"] = [{"id": "purchase:one", "material_id": "steel", "quantity": 1,
                                      "available_at": "2026-01-07T00:00:00", "source_type": "purchase"}]
    data["snapshot"]["work_orders"][0]["operations"][0]["material_requirements"] = [
        {"material_id": "steel", "fixed_quantity": 2}]
    # Pulsar captures the earliest material release in its immutable input;
    # the engine's pre-solve gate and dated ledger remain fully enforced.
    data["snapshot"]["work_orders"][0]["release_date"] = "2026-01-07T00:00:00"
    response = client.post("/internal/pulsar/run", json=data, headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()["assignments"][0]["start"] >= "2026-01-07T00:00:00"
    data["snapshot"]["supplies"][0]["available_at"] = "2026-01-08T00:00:00"
    data["snapshot"]["work_orders"][0]["release_date"] = "2026-01-08T00:00:00"
    later = client.post("/internal/pulsar/run", json=data, headers=headers())
    assert later.status_code == 200, later.text
    assert later.json()["assignments"][0]["start"] >= "2026-01-08T00:00:00"
    assert later.json()["input_snapshot_hash"] != response.json()["input_snapshot_hash"]


def test_mrp_private_stateless_bridge(client):
    body = {"version": "pulsar.mrp.v1", "as_of": "2026-09-15", "horizon_end": "2026-09-30",
            "items": [{"id": "i", "sku": "RAW", "name": "Raw", "unit": "KG", "method": "BUY", "on_hand": "0.1"}],
            "demands": [{"id": "d", "item_id": "i", "quantity": "0.3", "date": "2026-09-20", "reference": "Order"}], "supplies": []}
    assert client.post("/internal/pulsar/mrp", json=body).status_code == 422
    assert client.post("/internal/pulsar/mrp", json=body, headers={"X-Pulsar-Tenant": "one"}).status_code == 401
    for tenant in ("one", "two"):
        response = client.post("/internal/pulsar/mrp", json=body, headers=headers(tenant))
        assert response.status_code == 200
        assert response.json()["tenant_id"] == tenant
        assert response.json()["proposals"][0]["quantity"] == "0.2"
    body["items"][0]["method"] = "MAKE"
    assert client.post("/internal/pulsar/mrp", json=body, headers=headers()).status_code == 422


def zoned_payload():
    data = payload()
    data.update(
        bridge_version="pulsar.aps.v2",
        time_zone="America/Toronto",
        horizon_start="2026-01-05T05:00:00",
        horizon_end="2026-01-06T05:00:00",
        horizon_days=1,
        calendar_windows={"cal": [{"start": "2026-01-05T13:00:00", "end": "2026-01-05T22:00:00"}]},
    )
    return data


@pytest.mark.parametrize("strategy", ["greedy", "backward", "cpsat"])
def test_v2_uses_captured_windows_not_local_weekly_hours(client, strategy):
    data = zoned_payload()
    data["strategy"] = strategy
    result = calculate(client, data)
    assert result["time_zone"] == "America/Toronto"
    assert result["engine_revision"] == pulsar.ENGINE_V2
    assert result["horizon_end"] == data["horizon_end"]
    for a in result["assignments"]:
        assert "2026-01-05T13:00:00" <= a["start"] < a["end"] <= "2026-01-05T22:00:00"


def test_v2_exact_replay_and_hash_include_the_resolved_windows(client):
    data = zoned_payload()
    a, b = calculate(client, data), calculate(client, data)
    assert a["assignments"] == b["assignments"]
    assert a["input_snapshot_hash"] == b["input_snapshot_hash"]
    data["calendar_windows"]["cal"][0]["start"] = "2026-01-05T14:00:00"
    c = calculate(client, data)
    assert c["input_snapshot_hash"] != a["input_snapshot_hash"]
    assert c["assignments"][0]["start"] == "2026-01-05T14:00:00"


def test_v2_empty_resolved_calendar_does_not_fall_back_to_weekly_shifts(client):
    data = zoned_payload()
    data["calendar_windows"]["cal"] = []
    response = client.post("/internal/pulsar/run", json=data, headers=headers())
    assert response.status_code == 422, response.text
    assert "no working window" in response.text


@pytest.mark.parametrize("hours", [23, 25])
def test_explicit_horizon_can_differ_from_24_hour_days(client, hours):
    data = zoned_payload()
    data["horizon_end"] = f"2026-01-06T{hours - 19:02d}:00:00"
    assert calculate(client, data)["horizon_end"] == data["horizon_end"]


@pytest.mark.parametrize("change", ["missing", "foreign", "outside", "aware", "v1"])
def test_v2_invalid_calendar_contract_fails_closed(client, change):
    data = zoned_payload()
    if change == "missing":
        del data["calendar_windows"]
    if change == "foreign":
        data["calendar_windows"] = {"foreign": []}
    if change == "outside":
        data["calendar_windows"]["cal"][0]["start"] = "2026-01-04T00:00:00"
    if change == "aware":
        data["calendar_windows"]["cal"][0]["start"] += "Z"
    if change == "v1":
        data["bridge_version"] = pulsar.BRIDGE_VERSION
    response = client.post("/internal/pulsar/run", json=data, headers=headers())
    assert response.status_code == 422, response.text


def test_review_returns_comparison_without_publishing_and_remains_tenant_scoped(client):
    baseline, candidate = calculate(client), calculate(client)
    candidate["metrics"]["total_lateness_minutes"] = 120
    baseline["metrics"]["total_lateness_minutes"] = 0
    body = {"candidate": candidate, "baseline": baseline}
    reviewed = client.post("/internal/pulsar/review", json=body, headers=headers())
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["publish_status"] == "review"
    assert reviewed.json()["comparison"]["metric_delta"]["total_lateness_minutes"] == 120
    assert (
        client.post("/internal/pulsar/check-publication", json=body, headers=headers()).status_code
        == 422
    )
    assert (
        client.post("/internal/pulsar/review", json=body, headers=headers("other")).status_code
        == 400
    )


def calculate(client, data=None, tenant="tenant-a"):
    response = client.post("/internal/pulsar/run", json=data or payload(), headers=headers(tenant))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("strategy", ["greedy", "backward", "cpsat"])
def test_full_workflow_contract(client, strategy):
    data = payload()
    data["strategy"] = strategy
    result = calculate(client, data)
    assert result["organization_id"] == "tenant-a"
    assert result["bridge_version"] == pulsar.BRIDGE_VERSION
    assert result["engine_revision"] == pulsar.ENGINE_REVISION
    assert result["horizon_end"] == "2026-01-12T00:00:00"
    assert len(result["assignments"]) == 1
    assert result["metrics"] and result["summary"] and result["analysis"] and result["feasibility"]
    assert "planning_policy" in result["diagnostics"]
    assert "wip_remaining_split" in result["diagnostics"]


def test_replay_same_inputs_preserves_greedy_assignments(client):
    first, second = calculate(client), calculate(client)
    assert first["schedule_id"] != second["schedule_id"]
    assert first["assignments"] == second["assignments"]
    assert first["metrics"] == second["metrics"]


def test_simultaneous_tenants_with_colliding_business_ids_are_isolated(client):
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(calculate, client, payload(60), "tenant-a")
        b = pool.submit(calculate, client, payload(120), "tenant-b")
        first, second = a.result(), b.result()
    assert first["organization_id"] == "tenant-a"
    assert second["organization_id"] == "tenant-b"
    assert first["assignments"][0]["end"] == "2026-01-05T09:00:00"
    assert second["assignments"][0]["end"] == "2026-01-05T10:00:00"


@pytest.mark.parametrize(
    "bad_headers",
    [{}, {"X-API-Key": "bad", "X-Pulsar-Tenant": "tenant-a"}, {"X-API-Key": "test-service-key"}],
)
def test_no_demo_or_missing_key_fallback(client, bad_headers):
    response = client.post("/internal/pulsar/run", json=payload(), headers=bad_headers)
    assert response.status_code in (400, 401, 422)


def test_unconfigured_service_key_fails_closed(client, monkeypatch):
    monkeypatch.setattr(pulsar, "get_settings", lambda: SimpleNamespace(integration_api_key=None))
    assert client.post("/internal/pulsar/run", json=payload(), headers=headers()).status_code == 503


@pytest.mark.parametrize(
    "change",
    [
        {"time_zone": "America/Toronto"},
        {"bridge_version": "unknown"},
        {"horizon_start": "2026-01-05T00:00:00-05:00"},
    ],
)
def test_contract_and_timezone_are_explicit(client, change):
    assert (
        client.post(
            "/internal/pulsar/run", json={**payload(), **change}, headers=headers()
        ).status_code
        == 422
    )


def test_ineligible_machine_rejected(client):
    data = payload()
    data["snapshot"]["work_orders"][0]["operations"][0]["eligible_machine_ids"] = ["unknown"]
    assert client.post("/internal/pulsar/run", json=data, headers=headers()).status_code == 422


def test_publication_uses_engine_gate_and_does_not_persist(client):
    candidate = calculate(client)
    response = client.post(
        "/internal/pulsar/check-publication", json={"candidate": candidate}, headers=headers()
    )
    assert response.status_code == 200, response.text
    assert response.json()["publish_status"] == "publishable"
    # A request-local decision must not make the original result published.
    assert candidate["lifecycle_status"] == "draft"


@pytest.mark.parametrize("kind", ["infeasible", "exceptions", "cross-tenant", "review"])
def test_publication_refusals(client, kind):
    baseline, candidate = calculate(client), calculate(client)
    if kind == "infeasible":
        candidate["solver_status"] = "infeasible"
    elif kind == "exceptions":
        candidate["diagnostics"]["planner_exceptions"] = {"status": "blocked"}
    elif kind == "cross-tenant":
        candidate["organization_id"] = "tenant-b"
    else:
        baseline["metrics"]["total_lateness_minutes"] = 0
        candidate["metrics"]["total_lateness_minutes"] = 60
    response = client.post(
        "/internal/pulsar/check-publication",
        json={"candidate": candidate, "baseline": baseline},
        headers=headers(),
    )
    assert response.status_code in (400, 422), response.text


def test_started_operation_keeps_actual_assignment_via_full_workflow(client):
    data = payload()
    op = data["snapshot"]["work_orders"][0]["operations"][0]
    op.update(
        status="completed",
        actual_start="2026-01-05T10:00:00",
        actual_end="2026-01-05T11:00:00",
        actual_machine_id="m",
    )
    result = calculate(client, data)
    assert result["assignments"][0]["start"] == "2026-01-05T10:00:00"
    assert result["diagnostics"]["policy_wip_frozen_count"] == 1
