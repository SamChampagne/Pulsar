"""HTTP-level tests for /reports endpoints (J2a).

Use a fake PdfRenderer + fake use case so the route exercises:
- permission gate (anonymous -> 401, INTEGRATOR -> 403)
- response shape (content-type, content-disposition)
- feature flag for HTML preview (off by default -> 404)

The real renderer + real use case are exercised in
``tests/unit/use_cases/reports/test_build_production_sheet.py`` and
the integration suite.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_build_executive_dashboard,
    get_build_late_order_report,
    get_build_production_sheet,
    get_build_wo_traveler,
    get_list_accessible_workspaces,
    get_pdf_renderer,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import ListAccessibleWorkspaces
from planiadvance_v2.application.use_cases.reports.executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
)
from planiadvance_v2.application.use_cases.reports.late_order_payload import (
    LateOrderLine,
    LateOrderPayload,
)
from planiadvance_v2.application.use_cases.reports.production_sheet_payload import (
    ProductionSheetLine,
    ProductionSheetPayload,
)
from planiadvance_v2.application.use_cases.reports.wo_traveler_payload import (
    WoTravelerOperationLine,
    WoTravelerPayload,
)
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)

_TENANT_HEADERS = {"X-Organization-Id": "org-1", "X-User-Id": "user-1"}


def _payload() -> ProductionSheetPayload:
    return ProductionSheetPayload(
        machine_id="M-A",
        machine_name="Fraiseuse A",
        organization_name="Plant QC",
        workspace_name=None,
        date=date(2026, 5, 11),
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 11, 7, 30),
        lines=(
            ProductionSheetLine(
                operation_id="OP-1",
                work_order_ref="WO-1",
                work_order_name="Batch",
                sequence=1,
                start=datetime(2026, 5, 11, 8, 0),
                end=datetime(2026, 5, 11, 9, 0),
                setup_minutes=10,
                run_minutes=60,
            ),
        ),
        total_setup_minutes=10,
        total_run_minutes=60,
        total_operation_count=1,
    )


class _FakeUseCase:
    def __init__(self, payload: ProductionSheetPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> ProductionSheetPayload:
        return self._payload


class _FakeRenderer:
    def render(self, template_name: str, context: object) -> bytes:
        return b"%PDF-1.4 stub-from-fake-renderer"

    def render_html(self, template_name: str, context: object) -> str:
        return f"<html><body>preview {template_name}</body></html>"


def _late_order_payload() -> LateOrderPayload:
    return LateOrderPayload(
        organization_name="Plant QC",
        workspace_name=None,
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        horizon_start=datetime(2026, 5, 7),
        horizon_end=datetime(2026, 5, 21),
        lines=(
            LateOrderLine(
                work_order_ref="WO-1",
                work_order_name="Cabinet",
                due_date=datetime(2026, 5, 4, 17, 0),
                planned_end=datetime(2026, 5, 6, 9, 0),
                lateness_minutes=2400,
                priority="HIGH",
                reason="material",
                recommended_action="expedite_material",
            ),
        ),
        total_late_count=1,
        total_lateness_minutes=2400,
        by_reason={"material": 1, "capacity": 0, "priority": 0, "sequence": 0},
    )


class _FakeLateOrderUseCase:
    def __init__(self, payload: LateOrderPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> LateOrderPayload:
        return self._payload


@pytest.fixture
def api():
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-1", name="Plant QC", slug="plant-qc")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            ),
            Membership(
                organization_id="org-1",
                user_id="integrator-1",
                role=MembershipRole.INTEGRATOR,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository([])
    grants = InMemoryWorkspaceAccessGrantRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_build_production_sheet] = lambda: _FakeUseCase(
        _payload()
    )
    app.dependency_overrides[get_build_late_order_report] = (
        lambda: _FakeLateOrderUseCase(_late_order_payload())
    )
    app.dependency_overrides[get_pdf_renderer] = lambda: _FakeRenderer()

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_production_sheet_returns_pdf_bytes(api):
    response = api.get(
        "/reports/production-sheet?machine_id=M-A&date=2026-05-11",
        headers=_TENANT_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "production-sheet-M-A-2026-05-11.pdf" in response.headers[
        "content-disposition"
    ]


def test_production_sheet_anonymous_is_unauthorized(api):
    response = api.get("/reports/production-sheet?machine_id=M-A&date=2026-05-11")

    assert response.status_code == 401


def test_production_sheet_integrator_is_forbidden(api):
    response = api.get(
        "/reports/production-sheet?machine_id=M-A&date=2026-05-11",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )

    assert response.status_code == 403


def test_html_preview_disabled_by_default(api):
    response = api.get(
        "/reports/preview/production-sheet?machine_id=M-A&date=2026-05-11",
        headers=_TENANT_HEADERS,
    )

    # Feature flag off -> 404
    assert response.status_code == 404


# --- J2b: Late-order report ----------------------------------------------


def test_late_order_returns_pdf_bytes(api):
    response = api.get("/reports/late-orders", headers=_TENANT_HEADERS)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "late-orders" in response.headers["content-disposition"]


def test_late_order_anonymous_is_unauthorized(api):
    response = api.get("/reports/late-orders")
    assert response.status_code == 401


def test_late_order_integrator_is_forbidden(api):
    response = api.get(
        "/reports/late-orders",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_late_order_html_preview_disabled_by_default(api):
    response = api.get(
        "/reports/preview/late-orders",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404


# --- J2c: WO Traveler ----------------------------------------------------


def _wo_traveler_payload() -> WoTravelerPayload:
    return WoTravelerPayload(
        organization_name="Plant QC",
        workspace_name=None,
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        work_order_ref="WO-1",
        work_order_name="Cabinet",
        product_id="PROD-1",
        quantity=5,
        priority="HIGH",
        status="RELEASED",
        due_date=datetime(2026, 5, 10, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        planned_start=datetime(2026, 5, 5, 8, 0),
        planned_end=datetime(2026, 5, 6, 11, 0),
        operations=(
            WoTravelerOperationLine(
                operation_id="OP-1",
                sequence=1,
                name="Cutting",
                eligible_machine_ids=("M-A",),
                planned_machine_id="M-A",
                planned_start=datetime(2026, 5, 5, 8, 0),
                planned_end=datetime(2026, 5, 5, 9, 0),
                setup_minutes=10,
                run_minutes=60,
                materials=(),
            ),
        ),
        total_setup_minutes=10,
        total_run_minutes=60,
        total_operation_count=1,
    )


class _FakeWoTravelerUseCase:
    def __init__(self, payload: WoTravelerPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> WoTravelerPayload:
        return self._payload


def test_wo_traveler_returns_pdf_bytes(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-1", headers=_TENANT_HEADERS
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "wo-traveler-WO-1.pdf" in response.headers["content-disposition"]


def test_wo_traveler_anonymous_is_unauthorized(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get("/reports/wo-traveler?work_order_id=WO-1")
    assert response.status_code == 401


def test_wo_traveler_integrator_is_forbidden(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-1",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_wo_traveler_unknown_work_order_returns_404(api):
    from planiadvance_v2.application.use_cases.reports.build_wo_traveler import (
        WorkOrderNotFoundForReport,
    )

    class _RaisingUseCase:
        def execute(self, **_kwargs):
            raise WorkOrderNotFoundForReport("Work order WO-X not found.")

    api.app.dependency_overrides[get_build_wo_traveler] = lambda: _RaisingUseCase()

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-X",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"] == "work_order_not_found"


def test_wo_traveler_html_preview_disabled_by_default(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/preview/wo-traveler?work_order_id=WO-1",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404


# --- J2d: Executive Dashboard --------------------------------------------


def _dashboard_payload() -> ExecutiveDashboardOutput:
    return ExecutiveDashboardOutput(
        range_label="30d",
        range_start=datetime(2026, 4, 7, 12, 0),
        range_end=datetime(2026, 5, 7, 12, 0),
        generated_at=datetime(2026, 5, 7, 12, 0),
        scenarios_published_count=2,
        schedule_samples=(),
        current_kpis=KpiSnapshot(
            makespan_minutes=1234,
            on_time_ratio=0.83,
            avg_utilization=0.71,
            queue_time_minutes_avg=120,
            changeover_ratio=0.12,
            saturation_max=0.88,
            saturation_p95=0.85,
            wip_operation_count=3,
            campaign_efficiency=0.66,
            makespan_delta_minutes=-50,
            on_time_delta=0.05,
            avg_utilization_delta=-0.02,
            queue_time_delta_minutes=-15,
            changeover_delta=0.01,
            saturation_max_delta=0.05,
            saturation_p95_delta=0.04,
            wip_delta=1,
            campaign_efficiency_delta=0.06,
        ),
        top_late_orders=(),
    )


class _FakeDashboardUseCase:
    def __init__(self, payload: ExecutiveDashboardOutput) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> ExecutiveDashboardOutput:
        return self._payload


class _RaisingDashboardUseCase:
    def execute(self, **_kwargs):
        from planiadvance_v2.application.use_cases.reports import ReportError
        raise ReportError("range must be one of ['30d', '7d', '90d']; got 'bad'")


def test_dashboard_returns_json_with_expected_keys(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get("/reports/dashboard?range=30d", headers=_TENANT_HEADERS)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["range_label"] == "30d"
    assert body["scenarios_published_count"] == 2
    assert body["current_kpis"]["makespan_minutes"] == 1234
    assert "top_late_orders" in body
    assert "schedule_samples" in body


def test_dashboard_anonymous_is_unauthorized(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get("/reports/dashboard")
    assert response.status_code == 401


def test_dashboard_integrator_is_forbidden(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get(
        "/reports/dashboard",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_dashboard_invalid_range_returns_422(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _RaisingDashboardUseCase()
    )

    response = api.get(
        "/reports/dashboard?range=bad",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "invalid_range"
