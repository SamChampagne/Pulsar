"""Real-stack Postgres integration checks.

These tests exercise the actual SQL repositories and FastAPI wiring
against a live PostgreSQL database. They are intentionally opt-in:

- set ``PLANIADVANCE_STACK_TEST_DATABASE_URL`` to a reachable Postgres URL
- ideally point it to the Docker database on ``localhost:5555``

When the variable is missing or the database is unreachable, the tests
skip cleanly instead of failing the normal unit-test workflow.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from planiadvance_v2.api.main import create_app
from planiadvance_v2.config import get_settings
from planiadvance_v2.infrastructure.bootstrap import bootstrap
from planiadvance_v2.infrastructure.db import get_session_factory
from planiadvance_v2.infrastructure.db.migrations import run_migrations


def _weasyprint_runtime_available() -> bool:
    """True when WeasyPrint can render (Linux/macOS, or Windows + GTK)."""
    try:
        from weasyprint import HTML

        HTML(string="<p>x</p>").write_pdf()
        return True
    except Exception:
        return False


_HAS_WEASYPRINT = _weasyprint_runtime_available()


def _stack_database_url() -> str:
    url = os.environ.get("PLANIADVANCE_STACK_TEST_DATABASE_URL")
    if not url:
        pytest.skip(
            "Set PLANIADVANCE_STACK_TEST_DATABASE_URL to run Postgres real-stack tests."
        )
    return url


def _clear_runtime_caches() -> None:
    get_settings.cache_clear()
    get_session_factory.cache_clear()


def _truncate_all() -> None:
    factory = get_session_factory()
    with factory.session() as session:
        session.execute(
            text(
                """
                TRUNCATE TABLE
                    scheduled_operations,
                    schedules,
                    operation_routing_alternatives,
                    operation_resource_requirements,
                    operation_dependencies,
                    operation_eligible_machines,
                    operations,
                    supply_lots,
                    inventory_items,
                    resources,
                    machines,
                    calendar_shifts,
                    calendars,
                    work_orders
                RESTART IDENTITY CASCADE
                """
            )
        )


@contextmanager
def _real_stack_app(database_url: str, *, seed_dataset: str = "demo") -> Iterator[TestClient]:
    previous_database_url = os.environ.get("DATABASE_URL")
    previous_seed_dataset = os.environ.get("SEED_DATASET")
    previous_seed_reset = os.environ.get("SEED_RESET")
    previous_seed_anchor = os.environ.get("SEED_ANCHOR_TO_TODAY")
    os.environ["DATABASE_URL"] = database_url
    os.environ["SEED_DATASET"] = seed_dataset
    os.environ["SEED_RESET"] = "true"
    # The tests hard-code horizon_start in January 2026 to match the
    # reference dataset baseline. Anchoring would move those release
    # dates forward and the hard-coded horizon would fall outside.
    os.environ["SEED_ANCHOR_TO_TODAY"] = "false"
    _clear_runtime_caches()
    run_migrations(database_url)
    _truncate_all()
    bootstrap()
    app = create_app()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        if previous_seed_dataset is None:
            os.environ.pop("SEED_DATASET", None)
        else:
            os.environ["SEED_DATASET"] = previous_seed_dataset
        if previous_seed_reset is None:
            os.environ.pop("SEED_RESET", None)
        else:
            os.environ["SEED_RESET"] = previous_seed_reset
        if previous_seed_anchor is None:
            os.environ.pop("SEED_ANCHOR_TO_TODAY", None)
        else:
            os.environ["SEED_ANCHOR_TO_TODAY"] = previous_seed_anchor
        _clear_runtime_caches()


@pytest.mark.integration
class TestRealStackPostgres:
    def test_seeded_reference_data_is_visible_through_sql_api(self):
        database_url = _stack_database_url()

        with _real_stack_app(database_url) as client:
            machines = client.get("/machines")
            work_orders = client.get("/work-orders")

        assert machines.status_code == 200
        assert work_orders.status_code == 200
        machine_ids = {machine["id"] for machine in machines.json()}
        assert {"CNC-01", "CNC-02", "WELD-01", "ASSY-01"} <= machine_ids
        assert len(work_orders.json()) >= 5

    def test_run_compare_disruption_and_dashboard_hold_on_real_stack(self):
        database_url = _stack_database_url()

        with _real_stack_app(database_url) as client:
            run = client.post(
                "/scheduling/run",
                json={
                    "horizon_days": 14,
                    "strategy": "greedy",
                    "persist": True,
                },
            )
            assert run.status_code == 200
            run_data = run.json()
            schedule_id = run_data["schedule_id"]
            disruption_start = run_data["assignments"][0]["start"]

            compare = client.post(
                "/scheduling/compare",
                json={
                    "horizon_days": 14,
                    "strategies": ["greedy", "backward"],
                },
            )
            assert compare.status_code == 200
            compare_data = compare.json()

            disruption = client.post(
                "/scheduling/disruption",
                json={
                    "schedule_id": schedule_id,
                    "strategy": "greedy",
                    "persist": True,
                    "event": {
                        "disruption_type": "machine_down",
                        "timestamp": disruption_start,
                        "machine_id": "ASSY-01",
                        "event_end": run_data["assignments"][0]["end"],
                    },
                },
            )
            assert disruption.status_code == 200
            disruption_data = disruption.json()

            runs = client.get("/scheduling/runs")
            dashboard = client.get(f"/scheduling/runs/{schedule_id}/dashboard")

        assert run_data["strategy"] == "greedy"
        assert run_data["summary"]["scheduled_operation_count"] >= 1
        assert compare_data["summary"]["successful_runs"] >= 1
        assert len(compare_data["runs"]) == 2
        assert disruption_data["schedule_id"] != schedule_id
        assert disruption_data["summary"]["scheduled_operation_count"] >= 1
        assert runs.status_code == 200
        run_ids = {item["schedule_id"] for item in runs.json()}
        assert schedule_id in run_ids
        assert disruption_data["schedule_id"] in run_ids
        assert dashboard.status_code == 200
        dashboard_data = dashboard.json()
        assert dashboard_data["schedule_id"] == schedule_id
        assert "makespan_minutes" in dashboard_data["metrics"]

    def test_industrial_seed_supports_ui_critical_api_contract(self):
        database_url = _stack_database_url()

        with _real_stack_app(database_url, seed_dataset="industrial") as client:
            auth = client.post(
                "/auth/login",
                json={"user_id": "user-1", "organization_id": "org-demo"},
            )
            assert auth.status_code == 200
            auth_data = auth.json()
            headers = {
                "X-User-Id": auth_data["user"]["id"],
                "X-Organization-Id": auth_data["active_organization"]["id"],
            }

            health = client.get("/health")
            ready = client.get("/ready")
            me = client.get("/auth/me", headers=headers)
            machines = client.get("/machines", headers=headers)
            resources = client.get("/resources", headers=headers)
            inventory = client.get("/inventory", headers=headers)
            supplies = client.get("/supplies", headers=headers)
            work_orders = client.get("/work-orders", headers=headers)

            run = client.post(
                "/scheduling/run",
                json={
                    "horizon_start": "2026-01-05T00:00:00",
                    "horizon_days": 7,
                    "heuristic": "edd",
                    "strategy": "auto",
                    "persist": True,
                    "workspace_id": "default",
                    "scenario_name": "Industrial real-stack smoke",
                    "lifecycle_status": "simulation",
                },
                headers=headers,
            )
            assert run.status_code == 200
            run_data = run.json()
            schedule_id = run_data["schedule_id"]
            operation_id = "GAMMA-CNC"

            readiness = client.get(
                f"/scheduling/runs/{schedule_id}/readiness",
                headers=headers,
            )
            dashboard = client.get(
                f"/scheduling/runs/{schedule_id}/dashboard",
                headers=headers,
            )
            gantt = client.get(f"/scheduling/runs/{schedule_id}/gantt", headers=headers)
            feasible_slots = client.get(
                f"/scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots",
                headers=headers,
            )
            assert feasible_slots.status_code == 200
            selected_slot = next(
                (
                    slot
                    for slot in feasible_slots.json()["slots"]
                    if slot["baseline_machine_change"]
                    or slot["baseline_start_delta_minutes"]
                ),
                feasible_slots.json()["slots"][0],
            )
            edit_payload = {
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": operation_id,
                        "machine_id": selected_slot["machine_id"],
                        "reason": "real-stack assisted Gantt move",
                        "force_assignment": True,
                    }
                ],
                "horizon_start": "2026-01-05T00:00:00",
                "horizon_days": 7,
                "heuristic": "edd",
                "strategy": "auto",
                "reschedule_mode": "repair_local",
                "workspace_id": "default",
                "scenario_name": "Industrial real-stack candidate",
                "lifecycle_status": "draft",
            }
            preview = client.post(
                f"/scheduling/runs/{schedule_id}/edits/preview",
                json=edit_payload,
                headers=headers,
            )
            applied = client.post(
                f"/scheduling/runs/{schedule_id}/edits/apply",
                json=edit_payload,
                headers=headers,
            )
            assert applied.status_code == 200
            candidate_schedule_id = applied.json()["candidate_schedule_id"]
            comparison = client.post(
                "/scheduling/scenarios/compare",
                json={
                    "baseline_schedule_id": schedule_id,
                    "candidate_schedule_ids": [candidate_schedule_id],
                    "max_operation_changes": 25,
                },
                headers=headers,
            )
            published = client.post(
                f"/scheduling/scenarios/{candidate_schedule_id}/publish",
                json={
                    "baseline_schedule_id": schedule_id,
                    "scenario_name": "Approved industrial real-stack candidate",
                    "allow_review": True,
                },
                headers=headers,
            )

            # J2a: Production Sheet PDF — runs against the published schedule.
            # Pick a machine that has assignments and a date inside the
            # 7-day horizon (horizon_start = 2026-01-05).
            gantt_items = gantt.json()["items"]
            sample_assignment = next(
                (item for item in gantt_items if item.get("machine_id") and item.get("start")),
                None,
            )
            assert sample_assignment is not None, "industrial seed produced no assignments"
            sample_machine_id = sample_assignment["machine_id"]
            sample_date = sample_assignment["start"][:10]  # YYYY-MM-DD prefix
            production_sheet = client.get(
                "/reports/production-sheet",
                params={"machine_id": sample_machine_id, "date": sample_date},
                headers=headers,
            )

            # J2b: Late-order report — runs against the published schedule.
            # The industrial seed may have zero late WOs; the empty-state
            # path still produces a valid PDF.
            late_orders = client.get("/reports/late-orders", headers=headers)

            # J2c: WO Traveler — pick a seeded WO from the published schedule.
            sample_wo_id = work_orders.json()[0]["id"]
            wo_traveler = client.get(
                "/reports/wo-traveler",
                params={"work_order_id": sample_wo_id},
                headers=headers,
            )

            # J2d: Executive Dashboard JSON.
            dashboard = client.get(
                "/reports/dashboard",
                params={"range": "7d"},
                headers=headers,
            )

        assert auth_data["authenticated"] is True
        assert me.status_code == 200
        assert me.json()["authenticated"] is True
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"

        assert machines.status_code == 200
        assert {
            "LASER-1",
            "CNC-FAST",
            "CNC-FLEX",
            "PAINT-1",
            "ASSY-1",
            "ASSY-2",
            "PACK-1",
            "QA-1",
        } <= {
            machine["id"] for machine in machines.json()
        }

        assert resources.status_code == 200
        assert {
            "OPERATORS",
            "FIXTURE-A",
            "TOOLING-KIT",
            "ELECTRICAL-TECH",
            "PAINT-CREW",
            "PACK-CREW",
            "QA-INSPECTOR",
        } <= {
            resource["id"] for resource in resources.json()
        }

        assert inventory.status_code == 200
        assert {
            "RAW-AL",
            "RAW-STEEL",
            "PAINT-RED",
            "PAINT-BLUE",
            "FASTENER",
            "ELECTRONICS-KIT",
            "LABEL-KIT",
        } <= {
            item["material_id"] for item in inventory.json()
        }

        assert supplies.status_code == 200
        assert {"SUP-RAW-AL-MON-11", "SUP-ELECTRONICS-TUE-08"} <= {
            supply["id"] for supply in supplies.json()
        }

        assert work_orders.status_code == 200
        work_order_data = work_orders.json()
        assert {
            "WO-IND-ALPHA",
            "WO-IND-BETA",
            "WO-IND-GAMMA",
            "WO-IND-DELTA",
            "WO-IND-EPSILON",
            "WO-IND-ZETA",
        } <= {
            work_order["id"] for work_order in work_order_data
        }
        operations = [
            operation
            for work_order in work_order_data
            for operation in work_order["operations"]
        ]
        assert any(operation["routings"] for operation in operations)
        assert any(operation["resource_requirements"] for operation in operations)
        assert any(operation["material_requirements"] for operation in operations)
        assert len(operations) >= 20

        assert run_data["solver_status"] == "feasible"
        assert run_data["summary"]["scheduled_operation_count"] >= 20
        assert readiness.status_code == 200
        assert readiness.json()["status"] in {"ready", "attention"}
        assert dashboard.status_code == 200
        assert dashboard.json()["schedule_id"] == schedule_id
        assert gantt.status_code == 200
        assert gantt.json()["items"]
        assert feasible_slots.status_code == 200
        assert feasible_slots.json()["operation_id"] == operation_id
        assert "interaction_contract" in feasible_slots.json()
        assert preview.status_code == 200
        assert preview.json()["baseline_schedule_id"] == schedule_id
        assert applied.json()["baseline_schedule_id"] == schedule_id
        assert comparison.status_code == 200
        assert comparison.json()["summary"]["comparison_count"] == 1
        assert published.status_code == 200
        assert published.json()["lifecycle_status"] == "published"

        # J2a: Production Sheet renders end-to-end on real Postgres.
        # When the test runs in-process on Windows without GTK runtime,
        # WeasyPrint raises and the route returns 503; the route still
        # behaves correctly, just no actual PDF bytes. The Docker smoke
        # exercises the success path on Linux where GTK is installed.
        if _HAS_WEASYPRINT:
            assert production_sheet.status_code == 200, production_sheet.text
            assert production_sheet.headers["content-type"] == "application/pdf"
            assert production_sheet.content[:4] == b"%PDF"
            assert len(production_sheet.content) > 1024, (
                f"PDF too small: {len(production_sheet.content)} bytes"
            )
            assert "attachment" in production_sheet.headers["content-disposition"]

            assert late_orders.status_code == 200, late_orders.text
            assert late_orders.headers["content-type"] == "application/pdf"
            assert late_orders.content[:4] == b"%PDF"
            assert len(late_orders.content) > 1024, (
                f"Late-order PDF too small: {len(late_orders.content)} bytes"
            )
            assert "attachment" in late_orders.headers["content-disposition"]
            assert "late-orders" in late_orders.headers["content-disposition"]

            assert wo_traveler.status_code == 200, wo_traveler.text
            assert wo_traveler.headers["content-type"] == "application/pdf"
            assert wo_traveler.content[:4] == b"%PDF"
            assert len(wo_traveler.content) > 1024, (
                f"WO traveler PDF too small: {len(wo_traveler.content)} bytes"
            )
            assert "attachment" in wo_traveler.headers["content-disposition"]
            assert (
                f"wo-traveler-{sample_wo_id}"
                in wo_traveler.headers["content-disposition"]
            )
        else:
            assert production_sheet.status_code == 503, production_sheet.text
            body = production_sheet.json()
            assert body["error"] == "pdf_render_failed", body
            assert late_orders.status_code == 503, late_orders.text
            assert late_orders.json()["error"] == "pdf_render_failed"
            assert wo_traveler.status_code == 503, wo_traveler.text
            assert wo_traveler.json()["error"] == "pdf_render_failed"

        # J2d: Dashboard endpoint returns JSON regardless of WeasyPrint.
        assert dashboard.status_code == 200, dashboard.text
        dashboard_body = dashboard.json()
        assert dashboard_body["range_label"] == "7d"
        assert dashboard_body["scenarios_published_count"] >= 1
        assert "current_kpis" in dashboard_body
        assert "schedule_samples" in dashboard_body
