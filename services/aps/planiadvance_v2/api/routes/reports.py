"""HTTP routes for the J2a Reports module.

Currently exposes Production Sheet (PDF + HTML preview gated by
the ``reports_html_preview_enabled`` feature flag).
"""

from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Response

from ...application.ports.pdf_renderer import PdfRenderer, PdfRenderError
from ...application.use_cases.reports import (
    BuildExecutiveDashboard,
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
    WorkOrderNotFoundForReport,
)
from ...config import get_settings
from ..dependencies import (
    get_build_executive_dashboard,
    get_build_late_order_report,
    get_build_production_sheet,
    get_build_wo_traveler,
    get_pdf_renderer,
    get_tenant_scope_from_context,
)
from ..tenant import (
    TenantContext,
    ensure_authenticated_permission,
    get_tenant_context,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _scope_from_tenant(tenant: TenantContext):
    return get_tenant_scope_from_context(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )


def _build_payload(
    machine_id: str,
    target_date: date_type,
    tenant: TenantContext,
    use_case: BuildProductionSheet,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(
            machine_id=machine_id,
            target_date=target_date,
            scope=scope,
        )
    except MachineNotFoundForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "machine_not_found", "message": str(exc)},
        ) from exc
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc
    except RequestedDateOutsideHorizon as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "date_out_of_horizon",
                "message": str(exc),
                "horizon_start": (
                    exc.horizon_start.isoformat() if exc.horizon_start else None
                ),
                "horizon_end": (
                    exc.horizon_end.isoformat() if exc.horizon_end else None
                ),
            },
        ) from exc


@router.get("/production-sheet")
def production_sheet_pdf(
    machine_id: str,
    date: date_type,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildProductionSheet = Depends(get_build_production_sheet),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_payload(machine_id, date, tenant, use_case)
    try:
        pdf_bytes = renderer.render("production_sheet.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "pdf_render_failed",
                "message": str(exc),
            },
        ) from exc

    filename = f"production-sheet-{machine_id}-{date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/production-sheet")
def production_sheet_preview(
    machine_id: str,
    date: date_type,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildProductionSheet = Depends(get_build_production_sheet),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not get_settings().reports_html_preview_enabled:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Report preview is disabled."},
        )
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_payload(machine_id, date, tenant, use_case)
    try:
        html = renderer.render_html("production_sheet.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "pdf_render_failed",
                "message": str(exc),
            },
        ) from exc

    return Response(content=html, media_type="text/html")


def _build_late_order_payload(
    tenant: TenantContext,
    use_case: BuildLateOrderReport,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(scope=scope)
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc


@router.get("/late-orders")
def late_order_pdf(
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildLateOrderReport = Depends(get_build_late_order_report),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_late_order_payload(tenant, use_case)
    try:
        pdf_bytes = renderer.render("late_order_report.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    filename = (
        f"late-orders-{payload.schedule_id}-"
        f"{payload.generated_at.strftime('%Y%m%d')}.pdf"
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/late-orders")
def late_order_preview(
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildLateOrderReport = Depends(get_build_late_order_report),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not get_settings().reports_html_preview_enabled:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Report preview is disabled."},
        )
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_late_order_payload(tenant, use_case)
    try:
        html = renderer.render_html("late_order_report.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    return Response(content=html, media_type="text/html")


def _build_wo_traveler_payload(
    work_order_id: str,
    tenant: TenantContext,
    use_case: BuildWoTraveler,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(work_order_id=work_order_id, scope=scope)
    except WorkOrderNotFoundForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "work_order_not_found", "message": str(exc)},
        ) from exc
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc


@router.get("/wo-traveler")
def wo_traveler_pdf(
    work_order_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildWoTraveler = Depends(get_build_wo_traveler),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_wo_traveler_payload(work_order_id, tenant, use_case)
    try:
        pdf_bytes = renderer.render("wo_traveler.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    filename = f"wo-traveler-{work_order_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/wo-traveler")
def wo_traveler_preview(
    work_order_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildWoTraveler = Depends(get_build_wo_traveler),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not get_settings().reports_html_preview_enabled:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Report preview is disabled."},
        )
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_wo_traveler_payload(work_order_id, tenant, use_case)
    try:
        html = renderer.render_html("wo_traveler.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    return Response(content=html, media_type="text/html")


@router.get("/dashboard")
def executive_dashboard(
    range: str = "30d",
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildExecutiveDashboard = Depends(get_build_executive_dashboard),
) -> Response:
    import json

    ensure_authenticated_permission(tenant, "view_reports")

    scope = _scope_from_tenant(tenant)
    try:
        payload = use_case.execute(range_label=range, scope=scope)
    except ReportError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_range", "message": str(exc)},
        ) from exc

    return Response(
        content=json.dumps(payload.as_dict()),
        media_type="application/json",
    )
