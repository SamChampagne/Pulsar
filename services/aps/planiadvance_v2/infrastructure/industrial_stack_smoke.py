"""HTTP smoke check for the Docker industrial demo stack.

This module is intentionally dependency-free so it can run inside the API
Docker image with:

    python -m planiadvance_v2.infrastructure.industrial_stack_smoke
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass(frozen=True, slots=True)
class SmokeResult:
    schedule_id: str
    candidate_schedule_id: str
    operation_id: str
    assignment_count: int
    readiness_status: str
    gantt_entry_count: int
    feasible_slot_count: int
    comparison_count: int
    publish_status: str
    production_sheet_bytes: int
    production_sheet_machine_id: str
    production_sheet_date: str
    late_order_bytes: int
    wo_traveler_bytes: int
    wo_traveler_work_order_id: str
    dashboard_scenarios_count: int


class SmokeFailure(RuntimeError):
    """Raised when the industrial stack does not satisfy the UI/API contract."""


def _json_request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 15.0,
) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            data = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SmokeFailure(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise SmokeFailure(f"{method} {path} failed: {exc.reason}") from exc
    if not data:
        return None
    return json.loads(data.decode("utf-8"))


def _binary_request(
    base_url: str,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 15.0,
) -> tuple[bytes, str]:
    """Issue an HTTP request and return (body_bytes, content_type).

    Used for binary endpoints (PDF reports) where ``_json_request`` would
    fail trying to parse JSON.
    """

    request_headers = dict(headers or {})
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        method=method,
        headers=request_headers,
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SmokeFailure(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise SmokeFailure(f"{method} {path} failed: {exc.reason}") from exc
    return data, content_type


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def _wait_for_api(base_url: str, attempts: int, delay_seconds: float) -> None:
    last_error = "not attempted"
    for _ in range(attempts):
        try:
            health = _json_request(base_url, "GET", "/health", timeout_seconds=5.0)
            if health.get("status") == "ok":
                return
            last_error = f"unexpected health payload: {health}"
        except SmokeFailure as exc:
            last_error = str(exc)
        time.sleep(delay_seconds)
    raise SmokeFailure(f"API did not become healthy: {last_error}")


def _auth_headers(base_url: str) -> dict[str, str]:
    auth = _json_request(
        base_url,
        "POST",
        "/auth/login",
        {"user_id": "user-1", "organization_id": "org-demo"},
    )
    _require(auth.get("authenticated") is True, f"Auth login did not authenticate: {auth}")
    user = auth.get("user") or {}
    organization = auth.get("active_organization") or {}
    _require(user.get("id") == "user-1", f"Auth returned unexpected user: {auth}")
    _require(
        organization.get("id") == "org-demo",
        f"Auth returned unexpected organization: {auth}",
    )
    return {
        "X-User-Id": user["id"],
        "X-Organization-Id": organization["id"],
    }


def _operation_by_id(work_orders: list[dict[str, Any]], operation_id: str) -> dict[str, Any]:
    for work_order in work_orders:
        for operation in work_order.get("operations", []):
            if operation.get("id") == operation_id:
                return operation
    raise SmokeFailure(f"Operation {operation_id!r} was not found in seeded work orders.")


def _assignment_by_operation(assignments: list[dict[str, Any]], operation_id: str) -> dict[str, Any]:
    for assignment in assignments:
        if assignment.get("operation_id") == operation_id:
            return assignment
    raise SmokeFailure(f"Operation {operation_id!r} was not scheduled in baseline run.")


def _first_changed_slot(slots: list[dict[str, Any]]) -> dict[str, Any]:
    for slot in slots:
        if slot.get("baseline_machine_change") or slot.get("baseline_start_delta_minutes"):
            return slot
    _require(bool(slots), "Feasible-slot response returned no slot candidates.")
    return slots[0]


def run_industrial_stack_smoke(base_url: str) -> SmokeResult:
    """Validate the industrial seed and the UI-critical scheduling endpoints."""

    health = _json_request(base_url, "GET", "/health")
    _require(health.get("status") == "ok", f"/health is not ok: {health}")

    ready = _json_request(base_url, "GET", "/ready")
    _require(ready.get("status") == "ready", f"/ready is not ready: {ready}")

    headers = _auth_headers(base_url)
    me = _json_request(base_url, "GET", "/auth/me", headers=headers)
    _require(me.get("authenticated") is True, f"Auth context is not reusable: {me}")

    machines = _json_request(base_url, "GET", "/machines", headers=headers)
    machine_ids = {machine["id"] for machine in machines}
    _require(
        {
            "LASER-1",
            "CNC-FAST",
            "CNC-FLEX",
            "PAINT-1",
            "ASSY-1",
            "ASSY-2",
            "PACK-1",
            "QA-1",
        }
        <= machine_ids,
        f"Industrial machines are missing from API data: {sorted(machine_ids)}",
    )

    resources = _json_request(base_url, "GET", "/resources", headers=headers)
    resource_ids = {resource["id"] for resource in resources}
    _require(
        {
            "OPERATORS",
            "FIXTURE-A",
            "TOOLING-KIT",
            "ELECTRICAL-TECH",
            "PAINT-CREW",
            "PACK-CREW",
            "QA-INSPECTOR",
        }
        <= resource_ids,
        f"Industrial secondary resources are missing: {sorted(resource_ids)}",
    )

    inventory = _json_request(base_url, "GET", "/inventory", headers=headers)
    material_ids = {item["material_id"] for item in inventory}
    _require(
        {
            "RAW-AL",
            "RAW-STEEL",
            "PAINT-RED",
            "PAINT-BLUE",
            "FASTENER",
            "ELECTRONICS-KIT",
            "LABEL-KIT",
        }
        <= material_ids,
        f"Industrial inventory is missing: {sorted(material_ids)}",
    )

    supplies = _json_request(base_url, "GET", "/supplies", headers=headers)
    supply_ids = {supply["id"] for supply in supplies}
    _require(
        {"SUP-RAW-AL-MON-11", "SUP-ELECTRONICS-TUE-08"} <= supply_ids,
        f"Industrial inbound supply lot is missing: {sorted(supply_ids)}",
    )

    work_orders = _json_request(base_url, "GET", "/work-orders", headers=headers)
    work_order_ids = {work_order["id"] for work_order in work_orders}
    _require(
        {
            "WO-IND-ALPHA",
            "WO-IND-BETA",
            "WO-IND-GAMMA",
            "WO-IND-DELTA",
            "WO-IND-EPSILON",
            "WO-IND-ZETA",
        }
        <= work_order_ids,
        f"Industrial work orders are missing: {sorted(work_order_ids)}",
    )
    operations = [
        operation
        for work_order in work_orders
        for operation in work_order.get("operations", [])
    ]
    _require(
        any(operation.get("routings") for operation in operations),
        "Industrial work orders have no persisted routing alternatives.",
    )
    _require(
        any(operation.get("resource_requirements") for operation in operations),
        "Industrial work orders have no persisted secondary-resource requirements.",
    )
    _require(
        any(operation.get("material_requirements") for operation in operations),
        "Industrial work orders have no persisted material requirements.",
    )
    _require(
        len(operations) >= 20,
        f"Industrial seed should exercise a non-trivial schedule, got {len(operations)} ops.",
    )

    run = _json_request(
        base_url,
        "POST",
        "/scheduling/run",
        {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 7,
            "heuristic": "edd",
            "strategy": "auto",
            "persist": True,
            "workspace_id": "default",
            "scenario_name": "Industrial Docker smoke",
            "lifecycle_status": "simulation",
        },
        headers=headers,
    )
    schedule_id = run["schedule_id"]
    assignments = run.get("assignments", [])
    _require(run.get("solver_status") == "feasible", f"Scheduling run is not feasible: {run}")
    _require(assignments, "Scheduling run returned no assignments.")

    readiness = _json_request(
        base_url,
        "GET",
        f"/scheduling/runs/{schedule_id}/readiness",
        headers=headers,
    )
    readiness_status = readiness.get("status")
    _require(
        readiness_status in {"ready", "attention"},
        f"Planner readiness should be usable for UI handoff: {readiness}",
    )

    dashboard = _json_request(
        base_url,
        "GET",
        f"/scheduling/runs/{schedule_id}/dashboard",
        headers=headers,
    )
    _require(
        dashboard.get("schedule_id") == schedule_id,
        f"Dashboard returned the wrong schedule: {dashboard}",
    )
    _require(
        "makespan_minutes" in dashboard.get("metrics", {}),
        f"Dashboard metrics are incomplete: {dashboard}",
    )

    gantt = _json_request(
        base_url,
        "GET",
        f"/scheduling/runs/{schedule_id}/gantt",
        headers=headers,
    )
    gantt_items = gantt.get("items", [])
    _require(gantt.get("schedule_id") == schedule_id, f"Gantt returned wrong schedule: {gantt}")
    _require(gantt_items, "Gantt response returned no operation items.")
    first_gantt_item = gantt_items[0]
    _require(
        {
            "execution_status",
            "planning_lock",
            "planning_zone",
            "movable",
            "override_required",
            "lock_reason",
            "actual_start",
            "actual_machine_id",
            "actual_end",
            "actual_consumed_minutes",
            "remaining_duration_minutes",
            "planned_remaining_minutes",
            "wip_repair_mode",
            "firm_until",
            "frozen_until",
        }
        <= set(first_gantt_item),
        f"Gantt item is missing WIP/firm/frozen disposition fields: {first_gantt_item}",
    )

    operation_id = "GAMMA-CNC"
    _assignment_by_operation(assignments, operation_id)
    _operation_by_id(work_orders, operation_id)
    feasible_slots = _json_request(
        base_url,
        "GET",
        f"/scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots",
        headers=headers,
    )
    _require(
        feasible_slots.get("schedule_id") == schedule_id
        and feasible_slots.get("operation_id") == operation_id,
        f"Feasible-slot response is not tied to the requested operation: {feasible_slots}",
    )
    _require(
        "interaction_contract" in feasible_slots,
        f"Feasible-slot response is missing the UI interaction contract: {feasible_slots}",
    )
    selected_slot = _first_changed_slot(feasible_slots.get("slots", []))
    edit_payload = {
        "edits": [
            {
                "edit_type": "move_operation",
                "operation_id": operation_id,
                "machine_id": selected_slot["machine_id"],
                "reason": "industrial smoke assisted Gantt move",
                "force_assignment": True,
            }
        ],
        "horizon_start": "2026-01-05T00:00:00",
        "horizon_days": 7,
        "heuristic": "edd",
        "strategy": "auto",
        "reschedule_mode": "repair_local",
        "workspace_id": "default",
        "scenario_name": "Industrial Docker smoke candidate",
        "lifecycle_status": "draft",
    }

    preview = _json_request(
        base_url,
        "POST",
        f"/scheduling/runs/{schedule_id}/edits/preview",
        edit_payload,
        headers=headers,
    )
    _require(
        preview.get("baseline_schedule_id") == schedule_id,
        f"Preview did not reference the baseline schedule: {preview}",
    )
    _require(
        preview.get("planner_guidance", {}).get("status") in {
            "preview_ready",
            "review",
            "blocked",
        },
        f"Preview guidance is missing or invalid: {preview}",
    )

    applied = _json_request(
        base_url,
        "POST",
        f"/scheduling/runs/{schedule_id}/edits/apply",
        edit_payload,
        headers=headers,
    )
    candidate_schedule_id = applied.get("candidate_schedule_id")
    _require(candidate_schedule_id, f"Apply did not persist a candidate: {applied}")
    _require(
        applied.get("planner_guidance", {}).get("next_step") in {
            "compare_and_publish",
            "review_warnings_then_compare",
            "resolve_blockers_before_apply",
        },
        f"Apply guidance is not UI-actionable: {applied}",
    )

    comparison = _json_request(
        base_url,
        "POST",
        "/scheduling/scenarios/compare",
        {
            "baseline_schedule_id": schedule_id,
            "candidate_schedule_ids": [candidate_schedule_id],
            "max_operation_changes": 25,
        },
        headers=headers,
    )
    comparison_count = comparison.get("summary", {}).get("comparison_count")
    _require(comparison_count == 1, f"Scenario comparison failed: {comparison}")

    published = _json_request(
        base_url,
        "POST",
        f"/scheduling/scenarios/{candidate_schedule_id}/publish",
        {
            "baseline_schedule_id": schedule_id,
            "scenario_name": "Industrial Docker approved smoke",
            "allow_review": True,
        },
        headers=headers,
    )
    publish_status = str(published.get("publish_status"))
    _require(
        published.get("lifecycle_status") == "published",
        f"Scenario publish did not promote the candidate: {published}",
    )

    # J2a: Production Sheet PDF — fetch one for a real assignment so the
    # smoke proves the report endpoint works end-to-end against the
    # published schedule.
    sample_machine_id = str(gantt_items[0].get("machine_id"))
    sample_start = str(gantt_items[0].get("start"))
    sample_date = sample_start[:10]  # YYYY-MM-DD
    _require(
        len(sample_date) == 10 and sample_date[4] == "-" and sample_date[7] == "-",
        f"Cannot extract YYYY-MM-DD from assignment start: {sample_start!r}",
    )
    pdf_bytes, content_type = _binary_request(
        base_url,
        "GET",
        f"/reports/production-sheet?machine_id={sample_machine_id}&date={sample_date}",
        headers=headers,
    )
    _require(
        content_type.startswith("application/pdf"),
        f"Production sheet content-type is not PDF: {content_type!r}",
    )
    _require(
        pdf_bytes.startswith(b"%PDF"),
        f"Production sheet body does not start with %PDF: {pdf_bytes[:16]!r}",
    )
    _require(
        len(pdf_bytes) > 1024,
        f"Production sheet PDF too small ({len(pdf_bytes)} bytes)",
    )

    # J2b: Late-order report — empty industrial seed is acceptable;
    # the empty-state path still produces a valid PDF.
    late_order_pdf, late_order_content_type = _binary_request(
        base_url,
        "GET",
        "/reports/late-orders",
        headers=headers,
    )
    _require(
        late_order_content_type.startswith("application/pdf"),
        f"Late-order content-type is not PDF: {late_order_content_type!r}",
    )
    _require(
        late_order_pdf.startswith(b"%PDF"),
        f"Late-order body does not start with %PDF: {late_order_pdf[:16]!r}",
    )
    _require(
        len(late_order_pdf) > 1024,
        f"Late-order PDF too small ({len(late_order_pdf)} bytes)",
    )

    # J2c: WO Traveler — pick the alphabetically-first seeded WO id.
    sample_wo_id = sorted(work_order_ids)[0]
    wo_traveler_pdf, wo_traveler_content_type = _binary_request(
        base_url,
        "GET",
        f"/reports/wo-traveler?work_order_id={sample_wo_id}",
        headers=headers,
    )
    _require(
        wo_traveler_content_type.startswith("application/pdf"),
        f"WO traveler content-type is not PDF: {wo_traveler_content_type!r}",
    )
    _require(
        wo_traveler_pdf.startswith(b"%PDF"),
        f"WO traveler body does not start with %PDF: {wo_traveler_pdf[:16]!r}",
    )
    _require(
        len(wo_traveler_pdf) > 1024,
        f"WO traveler PDF too small ({len(wo_traveler_pdf)} bytes)",
    )

    # J2d: Executive Dashboard JSON.
    dashboard_payload = _json_request(
        base_url,
        "GET",
        "/reports/dashboard?range=7d",
        headers=headers,
    )
    _require(
        isinstance(dashboard_payload, dict)
        and dashboard_payload.get("range_label") == "7d",
        f"Dashboard payload missing or wrong range: {dashboard_payload!r}",
    )
    dashboard_scenarios_count = int(
        dashboard_payload.get("scenarios_published_count", 0)
    )
    _require(
        dashboard_scenarios_count >= 1,
        f"Dashboard reported {dashboard_scenarios_count} scenarios; expected >= 1.",
    )

    return SmokeResult(
        schedule_id=schedule_id,
        candidate_schedule_id=str(candidate_schedule_id),
        operation_id=operation_id,
        assignment_count=len(assignments),
        readiness_status=str(readiness_status),
        gantt_entry_count=len(gantt_items),
        feasible_slot_count=len(feasible_slots.get("slots", [])),
        comparison_count=int(comparison_count),
        publish_status=publish_status,
        production_sheet_bytes=len(pdf_bytes),
        production_sheet_machine_id=sample_machine_id,
        production_sheet_date=sample_date,
        late_order_bytes=len(late_order_pdf),
        wo_traveler_bytes=len(wo_traveler_pdf),
        wo_traveler_work_order_id=sample_wo_id,
        dashboard_scenarios_count=dashboard_scenarios_count,
    )


def main() -> int:
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    attempts = int(os.environ.get("SMOKE_API_ATTEMPTS", "30"))
    delay_seconds = float(os.environ.get("SMOKE_API_DELAY_SECONDS", "1"))
    try:
        _wait_for_api(base_url, attempts, delay_seconds)
        result = run_industrial_stack_smoke(base_url)
    except SmokeFailure as exc:
        print(f"Industrial stack smoke failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "schedule_id": result.schedule_id,
                "candidate_schedule_id": result.candidate_schedule_id,
                "operation_id": result.operation_id,
                "assignment_count": result.assignment_count,
                "readiness_status": result.readiness_status,
                "gantt_entry_count": result.gantt_entry_count,
                "feasible_slot_count": result.feasible_slot_count,
                "comparison_count": result.comparison_count,
                "publish_status": result.publish_status,
                "production_sheet_bytes": result.production_sheet_bytes,
                "production_sheet_machine_id": result.production_sheet_machine_id,
                "production_sheet_date": result.production_sheet_date,
                "late_order_bytes": result.late_order_bytes,
                "wo_traveler_bytes": result.wo_traveler_bytes,
                "wo_traveler_work_order_id": result.wo_traveler_work_order_id,
                "dashboard_scenarios_count": result.dashboard_scenarios_count,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
