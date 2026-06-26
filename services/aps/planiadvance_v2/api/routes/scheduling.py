"""Scheduling endpoints — triggers APS runs and analysis."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from importlib.util import find_spec

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...application.ports import AuditEventRepository, ScheduleRepository
from ...application.ports.schedule_repository import ScheduleRunMetadata
from ...application.ports.workspace_repository import WorkspaceRepository
from ...application.use_cases import (
    CapableToPromise,
    CapableToPromiseInput,
    CompareScenarios,
    CompareScenariosInput,
    CompareStrategies,
    CompareStrategiesInput,
    GetPlannerReadiness,
    GetScheduleCapacity,
    GetScheduleDashboard,
    GetScheduleGantt,
    GetScheduleRisk,
    ListSchedules,
    PlanningControlPlane,
    PublishScenario,
    PublishScenarioInput,
    RecordPlanningCandidateInput,
    RecordPlanningPublishInput,
    ReplayScheduleRun,
    ReplayScheduleRunInput,
    RunScheduling,
    SuggestOperationSlots,
    UpdateScheduleContext,
    UpdateScheduleContextInput,
    record_audit_event,
)
from ...application.use_cases.handle_disruption import (
    DisruptionEvent,
    DisruptionType,
)
from ...application.use_cases.planner_actions import PlannerAction
from ...application.use_cases.planner_diagnostics import enrich_planner_diagnostics
from ...application.use_cases.result_summary import build_schedule_summary
from ...application.use_cases.run_disruption import RunDisruption, RunDisruptionInput
from ...application.use_cases.run_scheduling import RunSchedulingInput
from ...domain.entities import Operation, WorkOrder
from ...domain.entities.material import MaterialRequirement
from ...domain.entities.operation import DependencyLink, DependencyType, RoutingAlternative
from ...domain.entities.resource import ResourceRequirement
from ...domain.errors import ValidationError
from ...domain.scheduling import Objective, available_strategies, available_strategy_profiles
from ...domain.value_objects import Duration, Priority, TransferTimes
from ...infrastructure.db.repositories import (
    SqlAuditEventRepository,
)
from ..dependencies import (
    get_audit_event_repository,
    get_capable_to_promise,
    get_compare_scenarios,
    get_compare_strategies,
    get_db_session,
    get_list_schedules,
    get_planner_readiness,
    get_planning_control_plane,
    get_publish_scenario,
    get_replay_schedule_run,
    get_run_disruption,
    get_run_scheduling,
    get_schedule_capacity,
    get_schedule_dashboard,
    get_schedule_gantt,
    get_schedule_repository,
    get_schedule_risk,
    get_suggest_operation_slots,
    get_update_schedule_context,
)
from ..openapi_examples import (
    CAPABLE_TO_PROMISE_EXAMPLES,
    COMPARE_STRATEGIES_EXAMPLES,
    DISRUPTION_EXAMPLES,
    RUN_SCHEDULING_EXAMPLES,
)
from ..schemas import (
    AnalysisOut,
    ApiErrorResponse,
    ApplyPlanningEditsRequest,
    ApplyPlanningEditsResponse,
    BottleneckOut,
    CapableToPromiseRequest,
    CapableToPromiseResponse,
    CompareScenariosRequest,
    CompareScenariosResponse,
    CompareStrategiesRequest,
    CompareStrategiesResponse,
    ComparisonSummaryOut,
    CriticalPathOut,
    DashboardResponse,
    FeasibilityIssueOut,
    FeasibilityReportOut,
    FlowTimeOut,
    GanttEntryOut,
    HandleDisruptionRequest,
    HandleDisruptionResponse,
    MachineCapacityResponse,
    MachineUtilizationOut,
    PlannerActionIn,
    PlannerReadinessResponse,
    PreviewPlanningEditsRequest,
    PreviewPlanningEditsResponse,
    PublishScenarioRequest,
    PublishScenarioResponse,
    RelaxationSuggestionOut,
    ReplayScheduleRunRequest,
    ReplayScheduleRunResponse,
    RunScheduleRequest,
    RunScheduleResponse,
    ScheduledOperationOut,
    ScheduleGanttResponse,
    ScheduleRiskResponse,
    ScheduleSummaryOut,
    StrategyCapabilitiesResponse,
    StrategyCapabilityOut,
    StrategyComparisonOut,
    SuggestOperationSlotsResponse,
    UpdateScheduleContextRequest,
)
from ..tenant import (
    TenantContext,
    ensure_permission,
    get_tenant_context,
    get_tenant_workspace_repository,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
    verify_payload_workspace_in_org,
)

router = APIRouter(prefix="/scheduling", tags=["scheduling"])


def _build_objective(payload) -> Objective:
    """Convert optional ObjectiveIn to domain Objective."""
    if payload.objective is None:
        return Objective.default()
    o = payload.objective
    return Objective(
        makespan=o.makespan,
        total_tardiness=o.total_tardiness,
        weighted_tardiness=o.weighted_tardiness,
        setup_cost=o.setup_cost,
        idle_penalty=o.idle_penalty,
        start_shift_penalty=o.start_shift_penalty,
        machine_change_penalty=o.machine_change_penalty,
    )


def _build_transfer_times(payload) -> TransferTimes:
    """Convert optional TransferTimesIn to domain TransferTimes."""
    if not hasattr(payload, "transfer_times") or payload.transfer_times is None:
        return TransferTimes()
    t = payload.transfer_times
    pairs = {(p.from_machine, p.to_machine): p.minutes for p in t.pairs}
    return TransferTimes(default_minutes=t.default_minutes, pairs=pairs)


def _build_planner_actions(payload) -> list[PlannerAction]:
    return [
        PlannerAction(
            action_type=action.action_type,
            operation_id=action.operation_id,
            work_order_id=action.work_order_id,
            machine_id=action.machine_id,
            calendar_id=action.calendar_id,
            due_date=action.due_date,
            setup_start=action.setup_start,
            start=action.start,
            end=action.end,
            priority=action.priority,
            reason=action.reason,
        )
        for action in getattr(payload, "planner_actions", [])
    ]


def _planner_action_dict(action: PlannerAction) -> dict[str, object]:
    return action.as_dict()


def _build_planner_actions_from_edits(
    payload: PreviewPlanningEditsRequest,
) -> tuple[list[PlannerAction], list[dict[str, object]], list[str]]:
    """Translate UI-friendly PlanningEdit objects into existing planner actions."""

    actions: list[PlannerAction] = []
    unsupported: list[dict[str, object]] = []
    warnings: list[str] = []
    for edit in payload.edits:
        edit_type = edit.edit_type.strip().lower()
        if edit_type == "move_operation":
            if not edit.operation_id or not edit.machine_id:
                unsupported.append(
                    {
                        "edit_type": edit.edit_type,
                        "reason": "move_operation requires operation_id and machine_id",
                    }
                )
                continue
            if edit.start and edit.end:
                actions.append(
                    PlannerAction(
                        action_type="pin_operation_window",
                        operation_id=edit.operation_id,
                        machine_id=edit.machine_id,
                        setup_start=edit.setup_start,
                        start=edit.start,
                        end=edit.end,
                        reason=edit.reason,
                    )
                )
                continue
            if edit.start or edit.end:
                unsupported.append(
                    {
                        "edit_type": edit.edit_type,
                        "reason": "move_operation exact pin requires both start and end",
                    }
                )
                continue
            actions.append(
                PlannerAction(
                    action_type="force_machine",
                    operation_id=edit.operation_id,
                    machine_id=edit.machine_id,
                    reason=edit.reason,
                )
            )
            continue

        if edit_type in {
            "force_machine",
            "freeze_operation",
            "unfreeze_operation",
            "standby_operation",
            "reinsert_standby_operation",
            "pin_operation_window",
            "change_priority",
            "override_due_date",
            "exclude_work_order",
            "add_overtime",
        }:
            actions.append(
                PlannerAction(
                    action_type=edit_type,
                    operation_id=edit.operation_id,
                    work_order_id=edit.work_order_id,
                    machine_id=edit.machine_id,
                    calendar_id=edit.calendar_id,
                    due_date=edit.due_date,
                    setup_start=edit.setup_start,
                    start=edit.start,
                    end=edit.end,
                    priority=edit.priority,
                    reason=edit.reason,
                )
            )
            continue

        unsupported.append(
            {
                "edit_type": edit.edit_type,
                "reason": "Unsupported planning edit type",
            }
        )
    return actions, unsupported, sorted(set(warnings))


def _interactive_edit_guidance(
    *,
    diagnostics: dict,
    unsupported_edits: list[dict[str, object]],
    warnings: list[str],
    persisted: bool,
) -> dict[str, object]:
    repair_scope = (
        diagnostics.get("repair_scope")
        if isinstance(diagnostics.get("repair_scope"), dict)
        else {}
    )
    planner_exceptions = (
        diagnostics.get("planner_exceptions")
        if isinstance(diagnostics.get("planner_exceptions"), dict)
        else {}
    )
    recommended: list[str] = []
    for item in repair_scope.get("recommended_actions", []) or []:
        if isinstance(item, dict) and isinstance(item.get("recommended_action"), str):
            recommended.append(item["recommended_action"])
    next_best = planner_exceptions.get("next_best_action")
    if isinstance(next_best, str) and next_best:
        recommended.append(next_best)

    repair_strategy = repair_scope.get("repair_strategy")
    if repair_strategy == "blocked_until_constraint_resolution":
        status = "blocked"
        next_step = "resolve_blockers_before_apply"
    elif unsupported_edits or warnings or planner_exceptions.get("status") == "attention":
        status = "review"
        next_step = "review_warnings_then_compare" if persisted else "review_preview"
    else:
        status = "candidate_saved" if persisted else "preview_ready"
        next_step = "compare_and_publish" if persisted else "apply_to_scenario"

    return {
        "version": "interactive-edit-guidance-v1",
        "status": status,
        "next_step": next_step,
        "repair_strategy": repair_strategy,
        "blocking_operation_ids": repair_scope.get("blocking_operation_ids", []),
        "impacted_operation_ids": repair_scope.get("impacted_operation_ids", []),
        "recommended_actions": list(dict.fromkeys(recommended)),
        "unsupported_edit_count": len(unsupported_edits),
        "warning_count": len(warnings),
    }


def _build_analysis_out(analysis) -> AnalysisOut | None:
    """Convert domain ScheduleAnalysis to API schema."""
    if analysis is None:
        return None
    cp = analysis.critical_path
    bn = analysis.bottleneck
    return AnalysisOut(
        critical_path=CriticalPathOut(
            operations=cp.operations,
            total_minutes=cp.total_minutes,
            work_orders=cp.work_orders,
        ),
        bottleneck=BottleneckOut(
            machine_id=bn.bottleneck_machine_id,
            utilization=round(bn.bottleneck_utilization, 4),
        ),
        flow_times=[
            FlowTimeOut(
                work_order_id=ft.work_order_id,
                flow_time_minutes=ft.flow_time_minutes,
                tardiness_minutes=ft.tardiness_minutes,
                is_on_time=ft.is_on_time,
            )
            for ft in analysis.flow_times
        ],
        machine_utilization=[
            MachineUtilizationOut(
                machine_id=m.machine_id,
                busy_minutes=m.busy_minutes,
                setup_minutes=m.setup_minutes,
                idle_minutes=m.idle_minutes,
                utilization=round(m.utilization, 4),
                num_operations=m.num_operations,
            )
            for m in bn.machines
        ],
        gantt=[
            GanttEntryOut(
                operation_id=g.operation_id,
                work_order_id=g.work_order_id,
                machine_id=g.machine_id,
                setup_start=g.setup_start,
                start=g.start,
                end=g.end,
                setup_minutes=g.setup_minutes,
                run_minutes=g.run_minutes,
            )
            for g in analysis.gantt
        ],
    )


def _build_feasibility_out(feasibility) -> FeasibilityReportOut | None:
    """Convert domain FeasibilityReport to API schema."""
    if feasibility is None:
        return None
    return FeasibilityReportOut(
        is_feasible=feasibility.is_feasible,
        error_count=feasibility.error_count,
        warning_count=feasibility.warning_count,
        readiness_status=feasibility.readiness_status,
        recommended_mode=feasibility.recommended_mode,
        dominant_issue_kind=feasibility.dominant_issue_kind,
        next_best_action=feasibility.next_best_action,
        planner_focus=feasibility.planner_focus,
        issues=[
            FeasibilityIssueOut(
                kind=i.kind.value,
                severity=i.severity.value,
                message=i.message,
                operation_id=i.operation_id,
                work_order_id=i.work_order_id,
                machine_id=i.machine_id,
            )
            for i in feasibility.issues
        ],
        suggestions=[
            RelaxationSuggestionOut(
                action=s.action,
                impact=s.impact,
                priority=s.priority,
                issue_kind=s.issue_kind,
                target_ids=list(s.target_ids),
                rationale=s.rationale,
                expected_mode=s.expected_mode,
            )
            for s in feasibility.suggestions
        ],
    )


def _build_summary_out(summary) -> ScheduleSummaryOut | None:
    if summary is None:
        return None
    return ScheduleSummaryOut(**summary.as_dict())


def _build_comparison_summary_out(summary) -> ComparisonSummaryOut | None:
    if summary is None:
        return None
    return ComparisonSummaryOut(**summary.as_dict())


def _build_run_response_from_schedule(schedule, metadata) -> RunScheduleResponse:
    diagnostics = enrich_planner_diagnostics(
        metadata.diagnostics,
        metrics=metadata.metrics,
        strategy=metadata.strategy,
    )
    return RunScheduleResponse(
        schedule_id=schedule.id,
        created_at=schedule.created_at,
        workspace_id=metadata.workspace_id,
        scenario_name=metadata.scenario_name,
        lifecycle_status=metadata.lifecycle_status,
        organization_id=metadata.organization_id,
        horizon_start=metadata.horizon_start,
        horizon_end=metadata.horizon_end,
        input_snapshot_hash=metadata.input_snapshot_hash,
        engine_version=metadata.engine_version,
        strategy=metadata.strategy,
        solver_status=metadata.solver_status,
        objective_value=metadata.objective_value,
        wall_time_ms=metadata.wall_time_ms,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in schedule.assignments
        ],
        metrics=metadata.metrics,
        summary=_build_summary_out(
            build_schedule_summary(
                schedule=schedule,
                metrics=metadata.metrics,
                diagnostics=diagnostics,
            )
        ),
        diagnostics=diagnostics,
    )


def _build_run_response_from_result(
    result,
    *,
    workspace_id: str = "default",
    scenario_name: str = "Default Scenario",
    lifecycle_status: str = "draft",
) -> RunScheduleResponse:
    return RunScheduleResponse(
        schedule_id=result.schedule.id,
        created_at=result.schedule.created_at,
        workspace_id=workspace_id,
        scenario_name=scenario_name,
        lifecycle_status=lifecycle_status,
        organization_id=result.organization_id,
        horizon_start=result.horizon_start,
        horizon_end=result.horizon_end,
        input_snapshot_hash=result.input_snapshot_hash,
        engine_version=result.engine_version,
        strategy=result.strategy,
        solver_status=result.solver_status,
        objective_value=result.objective_value,
        wall_time_ms=result.wall_time_ms,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in result.schedule.assignments
        ],
        metrics=result.metrics,
        summary=_build_summary_out(result.summary),
        analysis=_build_analysis_out(result.analysis),
        feasibility=_build_feasibility_out(result.feasibility),
        diagnostics=result.diagnostics,
    )


def _strategy_label(name: str) -> str:
    return {
        "auto": "Auto decision layer",
        "greedy": "Greedy finite scheduler",
        "hybrid": "Hybrid forward/backward",
        "backward": "Backward just-in-time",
        "cpsat": "CP-SAT exact solver",
        "infinite": "Infinite rough-cut",
        "sa": "Simulated annealing",
        "tabu": "Tabu search",
        "ga": "Genetic algorithm",
        "lns": "Large neighbourhood search",
        "multi": "Multi-start portfolio",
    }.get(name, name)


def _strategy_description(name: str, planning_mode: str, maturity: str) -> str:
    if name == "auto":
        return (
            "Planner decision layer: selects an operational strategy from current "
            "signals, due-date pressure, lifecycle and baseline context."
        )
    return (
        f"{planning_mode.replace('_', ' ')} strategy with {maturity} maturity. "
        "Use the profile flags to decide whether it belongs in baseline, compare, "
        "or advanced what-if flows."
    )


def _strategy_ui_groups(name: str, maturity: str, available: bool) -> list[str]:
    groups = ["api"]
    if name in {"auto", "greedy", "hybrid", "backward"} and available:
        groups.append("baseline")
    if available:
        groups.append("compare")
    if maturity in {"experimental", "specialized"}:
        groups.append("advanced")
    return groups


def _strategy_availability(name: str, registered: bool) -> tuple[bool, str | None]:
    if not registered:
        return False, "Strategy is documented but not registered in the runtime registry."
    if name == "cpsat" and find_spec("ortools") is None:
        return False, "CP-SAT requires optional dependency `ortools`."
    return True, None


def _auto_strategy_capability() -> StrategyCapabilityOut:
    return StrategyCapabilityOut(
        name="auto",
        label=_strategy_label("auto"),
        description=_strategy_description("auto", "planner_decision_layer", "production"),
        kind="decision_layer",
        maturity="production",
        planning_mode="planner_decision_layer",
        optimization_mode="rule_based_strategy_selection",
        recommended_for_disruption=True,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=True,
        supports_frozen_assignments=True,
        notes=[
            "Uses the engine decision layer instead of hardcoding one solver.",
            "Best UI default for baseline planning.",
        ],
        registered=True,
        available=True,
        ui_groups=["baseline", "compare", "api"],
        default_for_baseline=True,
    )


@router.get(
    "/strategies",
    response_model=StrategyCapabilitiesResponse,
    summary="List scheduling strategy capabilities",
    description=(
        "Return the planner-facing strategy catalog used by the UI. "
        "This endpoint is a capability contract, not a solve request: it exposes "
        "maturity, supported constraints, UI groups and runtime availability."
    ),
)
def list_strategy_capabilities() -> StrategyCapabilitiesResponse:
    registered = set(available_strategies())
    strategies = [_auto_strategy_capability()]
    for profile in available_strategy_profiles():
        is_registered = profile.name in registered
        available, reason = _strategy_availability(profile.name, is_registered)
        strategies.append(
            StrategyCapabilityOut(
                name=profile.name,
                label=_strategy_label(profile.name),
                description=_strategy_description(
                    profile.name,
                    profile.planning_mode,
                    profile.maturity,
                ),
                maturity=profile.maturity,
                planning_mode=profile.planning_mode,
                optimization_mode=profile.optimization_mode,
                recommended_for_disruption=profile.recommended_for_disruption,
                supports_secondary_resources=profile.supports_secondary_resources,
                supports_transfer_times=profile.supports_transfer_times,
                supports_routings=profile.supports_routings,
                supports_setup_matrix=profile.supports_setup_matrix,
                supports_maintenance_windows=profile.supports_maintenance_windows,
                supports_preemption=profile.supports_preemption,
                supports_frozen_assignments=profile.supports_frozen_assignments,
                notes=list(profile.notes),
                registered=is_registered,
                available=available,
                availability_reason=reason,
                ui_groups=_strategy_ui_groups(
                    profile.name,
                    profile.maturity,
                    available,
                ),
            )
        )
    return StrategyCapabilitiesResponse(strategies=strategies)


@router.post(
    "/run",
    response_model=RunScheduleResponse,
    summary="Run APS scheduling",
    description=(
        "Launch a scheduling run on the current workshop data. "
        "Use `greedy` for fast operational replanning and `cpsat` for small exact what-if studies."
    ),
    responses={
        422: {
            "model": ApiErrorResponse,
            "description": "Input is invalid or references unknown workshop entities.",
        }
    },
)
def run_scheduling(
    payload: RunScheduleRequest = Body(..., openapi_examples=RUN_SCHEDULING_EXAMPLES),
    use_case: RunScheduling = Depends(get_run_scheduling),
    tenant: TenantContext = Depends(get_tenant_context),
    workspaces: WorkspaceRepository = Depends(get_tenant_workspace_repository),
) -> RunScheduleResponse:
    ensure_permission(tenant, "run_scheduling")
    if tenant.organization_id:
        verify_payload_workspace_in_org(
            workspaces,
            organization_id=tenant.organization_id,
            workspace_id=payload.workspace_id,
        )
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    display_workspace_id = workspace_id or "default"
    try:
        result = use_case.execute(
            RunSchedulingInput(
                horizon_start=payload.horizon_start,
                horizon_days=payload.horizon_days,
                heuristic=payload.heuristic,
                strategy=payload.strategy,
                reschedule_mode=payload.reschedule_mode,
                objective=_build_objective(payload),
                transfer_times=_build_transfer_times(payload),
                persist=payload.persist,
                workspace_id=workspace_id,
                scenario_name=payload.scenario_name,
                lifecycle_status=payload.lifecycle_status,
                baseline_schedule_id=payload.baseline_schedule_id,
                organization_id=tenant.organization_id,
                planner_actions=_build_planner_actions(payload),
            )
        )
    except ImportError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Selected scheduling strategy is unavailable: {exc}",
        ) from exc
    return _build_run_response_from_result(
        result,
        workspace_id=display_workspace_id,
        scenario_name=payload.scenario_name,
        lifecycle_status=payload.lifecycle_status,
    )


@router.post(
    "/compare",
    response_model=CompareStrategiesResponse,
    summary="Compare scheduling strategies",
    description=(
        "Run several strategies on the same planning context to compare runtime, objective, "
        "lateness and planner-oriented recommendations."
    ),
    responses={
        422: {
            "model": ApiErrorResponse,
            "description": "Comparison request is invalid.",
        }
    },
)
def compare_strategies(
    payload: CompareStrategiesRequest = Body(
        ..., openapi_examples=COMPARE_STRATEGIES_EXAMPLES
    ),
    use_case: CompareStrategies = Depends(get_compare_strategies),
    tenant: TenantContext = Depends(get_tenant_context),
) -> CompareStrategiesResponse:
    ensure_permission(tenant, "run_scheduling")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    result = use_case.execute(
        CompareStrategiesInput(
            strategies=payload.strategies,
            horizon_start=payload.horizon_start,
            horizon_days=payload.horizon_days,
            objective=_build_objective(payload),
            transfer_times=_build_transfer_times(payload),
            baseline_schedule_id=payload.baseline_schedule_id,
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
        )
    )
    return CompareStrategiesResponse(
        best_strategy=result.best.strategy if result.best else None,
        summary=_build_comparison_summary_out(result.summary),
        runs=[
            StrategyComparisonOut(
                strategy=r.strategy,
                solver_status=r.solver_status,
                objective_value=r.objective_value,
                wall_time_ms=r.wall_time_ms,
                metrics=r.metrics,
                summary=_build_summary_out(r.summary),
                diagnostics=r.diagnostics,
                infeasibility=(
                    r.infeasibility.as_dict() if r.infeasibility is not None else None
                ),
                profile=r.profile,
                error=r.error,
            )
            for r in result.runs
        ],
    )


@router.get(
    "/runs",
    response_model=list[RunScheduleResponse],
    summary="List persisted scheduling runs",
)
def list_runs(
    limit: int = 20,
    workspace_id: str | None = None,
    lifecycle_status: str | None = None,
    use_case: ListSchedules = Depends(get_list_schedules),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[RunScheduleResponse]:
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    return [
        _build_run_response_from_schedule(s, meta)
        for s, meta in use_case.execute(
            limit=limit,
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            lifecycle_status=lifecycle_status,
        )
    ]


def _ensure_schedule_in_tenant_scope(
    schedule_id: str,
    metadata: ScheduleRunMetadata | None,
    tenant: TenantContext,
) -> ScheduleRunMetadata:
    """Return metadata if the schedule belongs to the caller; otherwise 404.

    A schedule that exists but lives in a different organisation/workspace
    is hidden behind the same 404 as a missing one — never confirm
    cross-tenant existence to the caller.
    """
    if metadata is None:
        raise HTTPException(
            status_code=404, detail=f"Schedule {schedule_id} not found"
        )
    if (
        tenant.organization_id is not None
        and metadata.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404, detail=f"Schedule {schedule_id} not found"
        )
    if (
        tenant.workspace_id is not None
        and metadata.workspace_id != tenant.workspace_id
    ):
        raise HTTPException(
            status_code=404, detail=f"Schedule {schedule_id} not found"
        )
    return metadata


def _audit_schedule_read(
    audit_repository: AuditEventRepository,
    *,
    action: str,
    schedule_id: str,
    metadata: ScheduleRunMetadata,
    tenant: TenantContext,
    details: dict[str, object] | None = None,
) -> None:
    """V1.2 — audit-log helper for /scheduling/runs/{id}/... read routes.

    Every legit (tenant-scoped) read on a schedule produces one
    append-only audit event so a planner / security review can trace
    who touched what. Best-effort: a failing audit must never block
    the underlying read — audit fails open. Used by replay_run +
    every GET on a schedule projection (dashboard, capacity,
    readiness, gantt, risk, feasible-slots).
    """

    try:
        record_audit_event(
            audit_repository,
            action=action,
            status="ok",
            organization_id=tenant.organization_id,
            workspace_id=metadata.workspace_id,
            user_id=tenant.user_id,
            subject=schedule_id,
            details=dict(details or {}),
        )
    except Exception:
        pass


@router.delete("/runs/{schedule_id}", status_code=204)
def delete_run(
    schedule_id: str,
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> None:
    _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    repo.delete(schedule_id)
    session.commit()


@router.patch(
    "/runs/{schedule_id}/context",
    response_model=RunScheduleResponse,
    summary="Update schedule workspace, scenario or lifecycle",
)
def update_run_context(
    schedule_id: str,
    payload: UpdateScheduleContextRequest,
    use_case: UpdateScheduleContext = Depends(get_update_schedule_context),
    schedules: ListSchedules = Depends(get_list_schedules),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> RunScheduleResponse:
    _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    try:
        use_case.execute(
            UpdateScheduleContextInput(
                schedule_id=schedule_id,
                workspace_id=payload.workspace_id,
                scenario_name=payload.scenario_name,
                lifecycle_status=payload.lifecycle_status,
            )
        )
        session.commit()
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    recent = schedules.execute(limit=1_000)
    for schedule, metadata in recent:
        if schedule.id == schedule_id:
            return _build_run_response_from_schedule(schedule, metadata)
    raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")


@router.post(
    "/scenarios/compare",
    response_model=CompareScenariosResponse,
    summary="Compare persisted schedule scenarios",
    description=(
        "Compare a baseline schedule run against one or more persisted candidate "
        "runs using KPI deltas, stability and publishability rules."
    ),
    responses={
        422: {"model": ApiErrorResponse, "description": "Scenario comparison is invalid."},
    },
)
def compare_scenarios(
    payload: CompareScenariosRequest,
    use_case: CompareScenarios = Depends(get_compare_scenarios),
    tenant: TenantContext = Depends(get_tenant_context),
) -> CompareScenariosResponse:
    ensure_permission(tenant, "view_plans")
    try:
        result = use_case.execute(
            CompareScenariosInput(
                baseline_schedule_id=payload.baseline_schedule_id,
                candidate_schedule_ids=payload.candidate_schedule_ids,
                organization_id=tenant.organization_id,
                max_operation_changes=payload.max_operation_changes,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CompareScenariosResponse(**result.as_dict())


@router.post(
    "/scenarios/{schedule_id}/publish",
    response_model=PublishScenarioResponse,
    summary="Publish a persisted schedule scenario",
    description=(
        "Promote a persisted schedule run to the published lifecycle after "
        "checking solver status, planner exceptions and optional baseline impact."
    ),
    responses={
        422: {"model": ApiErrorResponse, "description": "Scenario cannot be published."},
    },
)
def publish_scenario(
    schedule_id: str,
    payload: PublishScenarioRequest,
    use_case: PublishScenario = Depends(get_publish_scenario),
    planning: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> PublishScenarioResponse:
    ensure_permission(tenant, "publish_scenario")
    try:
        result = use_case.execute(
            PublishScenarioInput(
                schedule_id=schedule_id,
                baseline_schedule_id=payload.baseline_schedule_id,
                scenario_name=payload.scenario_name,
                organization_id=tenant.organization_id,
                allow_review=payload.allow_review,
            )
        )
        planning.record_publish(
            RecordPlanningPublishInput(
                schedule_id=schedule_id,
                previous_baseline_schedule_id=payload.baseline_schedule_id,
                organization_id=tenant.organization_id,
                workspace_id=result.metadata.workspace_id,
                user_id=tenant.user_id,
                publish_status=result.publish_status,
                recommendation=result.recommendation,
            )
        )
        # J7 pass 2 — audit publish (sensitive event: changes the
        # active baseline that all downstream planning will use).
        # Best-effort: a failing audit must never block publish.
        try:
            record_audit_event(
                SqlAuditEventRepository(session),
                action="scenario.publish",
                status=result.publish_status or "ok",
                organization_id=tenant.organization_id,
                workspace_id=result.metadata.workspace_id,
                user_id=tenant.user_id,
                subject=schedule_id,
                details={
                    "previous_baseline_schedule_id": payload.baseline_schedule_id,
                    "scenario_name": payload.scenario_name,
                    "recommendation": result.recommendation,
                },
            )
        except Exception:
            pass
        session.commit()
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PublishScenarioResponse(**result.as_dict())


@router.post(
    "/runs/{schedule_id}/replay",
    response_model=ReplayScheduleRunResponse,
    summary="Replay a persisted scheduling run from its audited input snapshot",
)
def replay_run(
    schedule_id: str,
    payload: ReplayScheduleRunRequest | None = None,
    use_case: ReplayScheduleRun = Depends(get_replay_schedule_run),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> ReplayScheduleRunResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    # V1.2 — audit replay specifically because it re-executes the
    # engine + returns the full input snapshot (the highest-leak
    # surface in the API). Read routes audit via the same helper.
    _audit_schedule_read(
        audit_repository,
        action="schedule.replay",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
        details={
            "strategy_override": payload.strategy if payload is not None else None,
        },
    )
    try:
        result = use_case.execute(
            ReplayScheduleRunInput(
                schedule_id=schedule_id,
                strategy=payload.strategy if payload is not None else None,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    replay = result.replay
    return ReplayScheduleRunResponse(
        original_schedule_id=result.original_schedule_id,
        input_snapshot_hash=result.input_snapshot_hash,
        replay_matches_original=result.replay_matches_original,
        hash_matches=result.hash_matches,
        strategy_matches=result.strategy_matches,
        objective_matches=result.objective_matches,
        assignment_delta=result.assignment_delta,
        metrics_delta=result.metrics_delta,
        divergence_reasons=result.divergence_reasons,
        replay_report=result.replay_report,
        replay=RunScheduleResponse(
            schedule_id=replay.schedule.id,
            created_at=replay.schedule.created_at,
            organization_id=replay.organization_id,
            horizon_start=replay.horizon_start,
            horizon_end=replay.horizon_end,
            input_snapshot_hash=result.input_snapshot_hash,
            engine_version=replay.engine_version,
            strategy=replay.strategy,
            solver_status=replay.solver_status,
            objective_value=replay.objective_value,
            wall_time_ms=replay.wall_time_ms,
            assignments=[
                ScheduledOperationOut(
                    operation_id=a.operation_id,
                    work_order_id=a.work_order_id,
                    machine_id=a.machine_id,
                    setup_start=a.setup_start,
                    start=a.start,
                    end=a.end,
                )
                for a in replay.schedule.assignments
            ],
            metrics=replay.metrics,
            summary=_build_summary_out(replay.summary),
            analysis=_build_analysis_out(replay.analysis),
            feasibility=_build_feasibility_out(replay.feasibility),
            diagnostics=replay.diagnostics,
        ),
    )


# -----------------------------------------------------------------------
# Schedule dashboard / KPIs
# -----------------------------------------------------------------------


@router.get(
    "/runs/{schedule_id}/dashboard",
    response_model=DashboardResponse,
    summary="Get a planner dashboard for one scheduling run",
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Schedule identifier is invalid."},
    },
)
def schedule_dashboard(
    schedule_id: str,
    use_case: GetScheduleDashboard = Depends(get_schedule_dashboard),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> DashboardResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.dashboard",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
    )
    try:
        result = use_case.execute(
            schedule_id,
            organization_id=tenant.organization_id,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc

    return DashboardResponse(
        schedule_id=result.schedule_id,
        workspace_id=result.workspace_id,
        scenario_name=result.scenario_name,
        lifecycle_status=result.lifecycle_status,
        work_order_count=result.work_order_count,
        operation_count=result.operation_count,
        machine_count=result.machine_count,
        metrics=result.metrics,
        summary=_build_summary_out(result.summary),
        analysis=_build_analysis_out(result.analysis),
        diagnostics=result.diagnostics,
        strategy=result.strategy,
        solver_status=result.solver_status,
        objective_value=result.objective_value,
        wall_time_ms=result.wall_time_ms,
    )


@router.get(
    "/runs/{schedule_id}/capacity",
    response_model=MachineCapacityResponse,
    summary="Get machine capacity and load buckets for one scheduling run",
    description=(
        "Return a read-only engine capacity ledger: effective machine calendar "
        "minutes, scheduled setup/run load, utilization, overload and bottleneck "
        "signals by day, week or full horizon."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Capacity window is invalid."},
    },
)
def schedule_capacity(
    schedule_id: str,
    bucket: str = Query(default="day"),
    window_start: datetime | None = Query(default=None),
    window_end: datetime | None = Query(default=None),
    use_case: GetScheduleCapacity = Depends(get_schedule_capacity),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> MachineCapacityResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.capacity",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
        details={"bucket": bucket},
    )
    try:
        result = use_case.execute(
            schedule_id,
            organization_id=tenant.organization_id,
            bucket=bucket,
            window_start=window_start,
            window_end=window_end,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return MachineCapacityResponse(**asdict(result))


@router.get(
    "/runs/{schedule_id}/readiness",
    response_model=PlannerReadinessResponse,
    summary="Validate whether a schedule is ready for planner/UI use",
    description=(
        "Return a compact readiness contract built from solver status, planner "
        "exceptions, repair scope, material pegging and stability diagnostics."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Schedule scope is invalid."},
    },
)
def schedule_readiness(
    schedule_id: str,
    use_case: GetPlannerReadiness = Depends(get_planner_readiness),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> PlannerReadinessResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.readiness",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
    )
    try:
        result = use_case.execute(
            schedule_id,
            organization_id=tenant.organization_id,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return PlannerReadinessResponse(**result.as_dict())


@router.get(
    "/runs/{schedule_id}/gantt",
    response_model=ScheduleGanttResponse,
    summary="Get a Gantt-ready projection for one scheduling run",
    description=(
        "Return operation bars, machine lanes, work-order lanes and interaction "
        "metadata for a future planner Gantt. This is read-only: UI edits should "
        "be previewed through planner actions instead of mutating assignments."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Schedule scope is invalid."},
    },
)
def schedule_gantt(
    schedule_id: str,
    baseline_schedule_id: str | None = None,
    use_case: GetScheduleGantt = Depends(get_schedule_gantt),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> ScheduleGanttResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    if baseline_schedule_id is not None:
        _ensure_schedule_in_tenant_scope(
            baseline_schedule_id, repo.get_metadata(baseline_schedule_id), tenant
        )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.gantt",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
        details={"baseline_schedule_id": baseline_schedule_id},
    )
    try:
        result = use_case.execute(
            schedule_id,
            organization_id=tenant.organization_id,
            baseline_schedule_id=baseline_schedule_id,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return ScheduleGanttResponse(**asdict(result))


@router.get(
    "/runs/{schedule_id}/risk",
    response_model=ScheduleRiskResponse,
    summary="Get operational schedule risk for a planning window",
    description=(
        "Summarize lateness, critical operations, machine pressure and locked "
        "planning constraints for the selected Gantt window. The response is "
        "read-only and intended to guide planner actions before preview/apply."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Risk window is invalid."},
    },
)
def schedule_risk(
    schedule_id: str,
    window_start: datetime | None = Query(default=None),
    window_end: datetime | None = Query(default=None),
    baseline_schedule_id: str | None = None,
    use_case: GetScheduleRisk = Depends(get_schedule_risk),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> ScheduleRiskResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    if baseline_schedule_id is not None:
        _ensure_schedule_in_tenant_scope(
            baseline_schedule_id, repo.get_metadata(baseline_schedule_id), tenant
        )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.risk",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
        details={"baseline_schedule_id": baseline_schedule_id},
    )
    try:
        result = use_case.execute(
            schedule_id,
            organization_id=tenant.organization_id,
            baseline_schedule_id=baseline_schedule_id,
            window_start=window_start,
            window_end=window_end,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return ScheduleRiskResponse(**asdict(result))


@router.get(
    "/runs/{schedule_id}/operations/{operation_id}/feasible-slots",
    response_model=SuggestOperationSlotsResponse,
    summary="Suggest feasible Gantt slots for an operation",
    description=(
        "Return engine-assisted placement candidates for a future interactive "
        "Gantt. The route reads the persisted baseline plan, ignores the "
        "operation's current assignment, then checks machine calendars, "
        "baseline occupancy, secondary resources, dependencies and material "
        "readiness before suggesting slots."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule or operation was not found."},
        422: {"model": ApiErrorResponse, "description": "Slot suggestion is invalid."},
    },
)
def suggest_operation_slots(
    schedule_id: str,
    operation_id: str,
    search_start: datetime | None = None,
    max_results: int = Query(8, ge=1, le=50),
    use_case: SuggestOperationSlots = Depends(get_suggest_operation_slots),
    repo: ScheduleRepository = Depends(get_schedule_repository),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: AuditEventRepository = Depends(get_audit_event_repository),
) -> SuggestOperationSlotsResponse:
    ensure_permission(tenant, "view_plans")
    metadata = _ensure_schedule_in_tenant_scope(
        schedule_id, repo.get_metadata(schedule_id), tenant
    )
    _audit_schedule_read(
        audit_repository,
        action="schedule.read.feasible_slots",
        schedule_id=schedule_id,
        metadata=metadata,
        tenant=tenant,
        details={"operation_id": operation_id},
    )
    try:
        result = use_case.execute(
            schedule_id,
            operation_id,
            organization_id=tenant.organization_id,
            search_start=search_start,
            max_results=max_results,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return SuggestOperationSlotsResponse(**asdict(result))


@router.post(
    "/runs/{schedule_id}/edits/preview",
    response_model=PreviewPlanningEditsResponse,
    summary="Preview planner edits against a persisted schedule",
    description=(
        "Translate interactive Gantt edits into planner actions, run a local "
        "repair preview with the selected schedule as baseline, and return the "
        "candidate plan without persisting it."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Baseline schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Edit preview is invalid."},
    },
)
def preview_planning_edits(
    schedule_id: str,
    payload: PreviewPlanningEditsRequest,
    use_case: RunScheduling = Depends(get_run_scheduling),
    gantt_use_case: GetScheduleGantt = Depends(get_schedule_gantt),
    tenant: TenantContext = Depends(get_tenant_context),
) -> PreviewPlanningEditsResponse:
    ensure_permission(tenant, "edit_plan")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    display_workspace_id = workspace_id or "default"
    planner_actions, unsupported_edits, warnings = _build_planner_actions_from_edits(
        payload
    )
    if not planner_actions:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "No supported planning edits to preview.",
                "unsupported_edits": unsupported_edits,
            },
        )

    try:
        result = use_case.execute(
            RunSchedulingInput(
                horizon_start=payload.horizon_start,
                horizon_days=payload.horizon_days,
                heuristic=payload.heuristic,
                strategy=payload.strategy,
                reschedule_mode=payload.reschedule_mode,
                objective=_build_objective(payload),
                transfer_times=_build_transfer_times(payload),
                persist=False,
                workspace_id=workspace_id,
                scenario_name=payload.scenario_name,
                lifecycle_status=payload.lifecycle_status,
                baseline_schedule_id=schedule_id,
                organization_id=tenant.organization_id,
                planner_actions=planner_actions,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc

    try:
        gantt = gantt_use_case.build_preview(
            result.schedule,
            organization_id=tenant.organization_id,
            baseline_schedule_id=schedule_id,
            workspace_id=workspace_id,
            scenario_name=payload.scenario_name,
            lifecycle_status=payload.lifecycle_status,
            horizon_start=result.horizon_start,
            horizon_end=result.horizon_end,
            strategy=result.strategy,
            solver_status=result.solver_status,
            input_snapshot_hash=result.input_snapshot_hash,
            engine_version=result.engine_version,
            diagnostics=result.diagnostics,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc

    return PreviewPlanningEditsResponse(
        baseline_schedule_id=schedule_id,
        planner_actions=[
            PlannerActionIn(
                action_type=action.action_type,
                operation_id=action.operation_id,
                work_order_id=action.work_order_id,
                machine_id=action.machine_id,
                calendar_id=action.calendar_id,
                due_date=action.due_date,
                setup_start=action.setup_start,
                start=action.start,
                end=action.end,
                priority=action.priority,
                reason=action.reason,
            )
            for action in planner_actions
        ],
        unsupported_edits=unsupported_edits,
        warnings=warnings,
        planner_guidance=_interactive_edit_guidance(
            diagnostics=result.diagnostics,
            unsupported_edits=unsupported_edits,
            warnings=warnings,
            persisted=False,
        ),
        preview=_build_run_response_from_result(
            result,
            workspace_id=display_workspace_id,
            scenario_name=payload.scenario_name,
            lifecycle_status=payload.lifecycle_status,
        ),
        gantt=ScheduleGanttResponse(**asdict(gantt)),
    )


@router.post(
    "/runs/{schedule_id}/edits/apply",
    response_model=ApplyPlanningEditsResponse,
    summary="Apply planner edits as a persisted candidate scenario",
    description=(
        "Translate interactive Gantt edits into planner actions, run a local "
        "repair against the selected baseline, persist the candidate schedule, "
        "and return the saved scenario plus Gantt deltas for review."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Baseline schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Edit application is invalid."},
    },
)
def apply_planning_edits(
    schedule_id: str,
    payload: ApplyPlanningEditsRequest,
    use_case: RunScheduling = Depends(get_run_scheduling),
    gantt_use_case: GetScheduleGantt = Depends(get_schedule_gantt),
    planning: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> ApplyPlanningEditsResponse:
    ensure_permission(tenant, "edit_plan")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    display_workspace_id = workspace_id or "default"
    planner_actions, unsupported_edits, warnings = _build_planner_actions_from_edits(
        payload
    )
    if not planner_actions:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "No supported planning edits to apply.",
                "unsupported_edits": unsupported_edits,
            },
        )

    try:
        result = use_case.execute(
            RunSchedulingInput(
                horizon_start=payload.horizon_start,
                horizon_days=payload.horizon_days,
                heuristic=payload.heuristic,
                strategy=payload.strategy,
                reschedule_mode=payload.reschedule_mode,
                objective=_build_objective(payload),
                transfer_times=_build_transfer_times(payload),
                persist=True,
                workspace_id=workspace_id,
                scenario_name=payload.scenario_name,
                lifecycle_status=payload.lifecycle_status,
                baseline_schedule_id=schedule_id,
                organization_id=tenant.organization_id,
                planner_actions=planner_actions,
            )
        )
        session.commit()
        gantt = gantt_use_case.build_preview(
            result.schedule,
            organization_id=tenant.organization_id,
            baseline_schedule_id=schedule_id,
            workspace_id=workspace_id,
            scenario_name=payload.scenario_name,
            lifecycle_status=payload.lifecycle_status,
            horizon_start=result.horizon_start,
            horizon_end=result.horizon_end,
            strategy=result.strategy,
            solver_status=result.solver_status,
            input_snapshot_hash=result.input_snapshot_hash,
            engine_version=result.engine_version,
            diagnostics=result.diagnostics,
        )
        planning.record_candidate(
            RecordPlanningCandidateInput(
                source_schedule_id=schedule_id,
                candidate_schedule_id=result.schedule.id,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                user_id=tenant.user_id,
                planner_actions=[
                    _planner_action_dict(action) for action in planner_actions
                ],
                unsupported_edits=unsupported_edits,
                warnings=warnings,
                scenario_name=payload.scenario_name,
            )
        )
        session.commit()
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc

    candidate = _build_run_response_from_result(
        result,
        workspace_id=display_workspace_id,
        scenario_name=payload.scenario_name,
        lifecycle_status=payload.lifecycle_status,
    )
    return ApplyPlanningEditsResponse(
        baseline_schedule_id=schedule_id,
        candidate_schedule_id=result.schedule.id,
        planner_actions=[
            PlannerActionIn(
                action_type=action.action_type,
                operation_id=action.operation_id,
                work_order_id=action.work_order_id,
                machine_id=action.machine_id,
                calendar_id=action.calendar_id,
                due_date=action.due_date,
                setup_start=action.setup_start,
                start=action.start,
                end=action.end,
                priority=action.priority,
                reason=action.reason,
            )
            for action in planner_actions
        ],
        unsupported_edits=unsupported_edits,
        warnings=warnings,
        planner_guidance=_interactive_edit_guidance(
            diagnostics=result.diagnostics,
            unsupported_edits=unsupported_edits,
            warnings=warnings,
            persisted=True,
        ),
        candidate=candidate,
        gantt=ScheduleGanttResponse(**asdict(gantt)),
    )


# -----------------------------------------------------------------------
# Disruption handling
# -----------------------------------------------------------------------

_DISRUPTION_TYPE_MAP = {
    "machine_down": DisruptionType.MACHINE_DOWN,
    "rush_order": DisruptionType.RUSH_ORDER,
    "operation_delay": DisruptionType.OPERATION_DELAY,
}


def _build_rush_order(
    payload,
    organization_id: str | None = None,
    workspace_id: str | None = None,
) -> WorkOrder | None:
    """Convert a WorkOrderIn to a domain WorkOrder for rush orders."""
    if payload is None:
        return None
    ops = []
    prev_id = None
    for op_in in payload.operations:
        ops.append(
            Operation(
                id=op_in.id,
                work_order_id=payload.id,
                sequence=op_in.sequence,
                name=op_in.name,
                duration=Duration(minutes=op_in.duration_minutes),
                setup_time=Duration(minutes=op_in.setup_minutes),
                eligible_machine_ids=op_in.eligible_machine_ids,
                dependencies=op_in.dependencies if op_in.dependencies else (
                    [prev_id] if prev_id else []
                ),
                dependency_links=[
                    DependencyLink(
                        depends_on_id=link.depends_on_id,
                        dependency_type=DependencyType(link.dependency_type),
                        lag_minutes=link.lag_minutes,
                        max_wait_minutes=link.max_wait_minutes,
                    )
                    for link in op_in.dependency_links
                ],
                setup_family=op_in.setup_family,
                preemptible=op_in.preemptible,
                min_chunk=Duration(minutes=op_in.min_chunk_minutes),
                resource_requirements=[
                    ResourceRequirement(
                        resource_id=rr.resource_id, units=rr.units
                    )
                    for rr in op_in.resource_requirements
                ],
                material_requirements=[
                    MaterialRequirement(
                        material_id=req.material_id,
                        quantity_per_unit=req.quantity_per_unit,
                        fixed_quantity=req.fixed_quantity,
                    )
                    for req in op_in.material_requirements
                ],
                routings=[
                    RoutingAlternative(
                        machine_id=alt.machine_id,
                        duration=Duration(minutes=alt.duration_minutes),
                        setup_time=Duration(minutes=alt.setup_minutes),
                        resource_requirements=tuple(
                            ResourceRequirement(
                                resource_id=rr.resource_id, units=rr.units
                            )
                            for rr in alt.resource_requirements
                        ),
                    )
                    for alt in op_in.routings
                ],
            )
        )
        prev_id = op_in.id
    return WorkOrder(
        id=payload.id,
        name=payload.name,
        product_id=payload.product_id,
        quantity=payload.quantity,
        due_date=payload.due_date,
        release_date=payload.release_date,
        priority=Priority(payload.priority),
        operations=ops,
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


@router.post(
    "/ctp",
    response_model=CapableToPromiseResponse,
    summary="Run rough-cut capable-to-promise",
    description=(
        "Simulate insertion of a candidate work order without persisting a schedule. "
        "Defaults to the infinite-capacity rough-cut strategy for a fast promise date."
    ),
    responses={
        422: {"model": ApiErrorResponse, "description": "CTP payload is invalid."},
    },
)
def capable_to_promise(
    payload: CapableToPromiseRequest = Body(
        ..., openapi_examples=CAPABLE_TO_PROMISE_EXAMPLES
    ),
    use_case: CapableToPromise = Depends(get_capable_to_promise),
    tenant: TenantContext = Depends(get_tenant_context),
) -> CapableToPromiseResponse:
    ensure_permission(tenant, "run_scheduling")
    payload_org = (
        payload.candidate_order.organization_id
        if payload.candidate_order is not None
        else None
    )
    organization_id = resolve_scoped_organization_id(tenant, payload_org)
    workspace_id = resolve_scoped_workspace_id(
        tenant,
        payload.workspace_id or payload.candidate_order.workspace_id,
    )
    candidate = _build_rush_order(
        payload.candidate_order,
        organization_id,
        workspace_id,
    )
    if candidate is None:
        raise HTTPException(status_code=422, detail="candidate_order is required")
    result = use_case.execute(
        CapableToPromiseInput(
            candidate_order=candidate,
            horizon_start=payload.horizon_start,
            horizon_days=payload.horizon_days,
            strategy=payload.strategy,
            finite_validation=payload.finite_validation,
            finite_strategy=payload.finite_strategy,
            promise_dates=tuple(payload.promise_dates),
            objective=_build_objective(payload),
            transfer_times=_build_transfer_times(payload),
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
    )
    return CapableToPromiseResponse(
        feasible=result.feasible,
        strategy=result.strategy,
        solver_status=result.solver_status,
        earliest_completion=result.earliest_completion,
        due_date=result.due_date,
        promise_delta_minutes=result.promise_delta_minutes,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in result.schedule.assignments
            if a.work_order_id == candidate.id
        ],
        metrics=result.metrics,
        insertion_impact=result.insertion_impact,
        available_quantity_by_date=result.available_quantity_by_date,
        rough_cut_capacity=result.rough_cut_capacity,
        planner_explanation=result.planner_explanation,
        recommendation=result.recommendation,
        finite_validation=result.finite_validation,
        diagnostics=result.diagnostics,
    )


@router.post(
    "/disruption",
    response_model=HandleDisruptionResponse,
    summary="Replan after a disruption event",
    description=(
        "Apply a machine-down, rush-order or operation-delay event to a persisted schedule "
        "and return the replanned result."
    ),
    responses={
        404: {"model": ApiErrorResponse, "description": "Schedule was not found."},
        422: {"model": ApiErrorResponse, "description": "Disruption payload is invalid."},
    },
)
def handle_disruption(
    payload: HandleDisruptionRequest = Body(
        ..., openapi_examples=DISRUPTION_EXAMPLES
    ),
    use_case: RunDisruption = Depends(get_run_disruption),
    tenant: TenantContext = Depends(get_tenant_context),
) -> HandleDisruptionResponse:
    ensure_permission(tenant, "edit_plan")
    dtype_str = payload.event.disruption_type.lower().strip()
    dtype = _DISRUPTION_TYPE_MAP.get(dtype_str)
    if dtype is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown disruption_type: {payload.event.disruption_type!r}. "
            f"Valid: {list(_DISRUPTION_TYPE_MAP.keys())}",
        )

    try:
        event = DisruptionEvent(
            disruption_type=dtype,
            timestamp=payload.event.timestamp,
            machine_id=payload.event.machine_id,
            event_end=payload.event.event_end,
            operation_id=payload.event.operation_id,
            new_end=payload.event.new_end,
            rush_order=_build_rush_order(
                payload.event.rush_order,
                tenant.organization_id,
                resolve_scoped_workspace_id(tenant, payload.workspace_id),
            ),
        )
        workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
        result = use_case.execute(
            RunDisruptionInput(
                event=event,
                schedule_id=payload.schedule_id,
                horizon_days=payload.horizon_days,
                strategy=payload.strategy,
                reschedule_mode=payload.reschedule_mode,
                objective=_build_objective(payload),
                transfer_times=_build_transfer_times(payload),
                persist=payload.persist,
                workspace_id=workspace_id,
                scenario_name=payload.scenario_name,
                lifecycle_status=payload.lifecycle_status,
                organization_id=tenant.organization_id,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return HandleDisruptionResponse(
        schedule_id=result.schedule.id,
        workspace_id=result.workspace_id,
        scenario_name=result.scenario_name,
        lifecycle_status=result.lifecycle_status,
        reschedule_mode=result.reschedule_mode,
        frozen_count=result.frozen_count,
        rescheduled_count=result.rescheduled_count,
        strategy=result.strategy,
        solver_status=result.solver_status,
        objective_value=result.objective_value,
        wall_time_ms=result.wall_time_ms,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in result.schedule.assignments
        ],
        metrics=result.metrics,
        summary=_build_summary_out(result.summary),
        analysis=_build_analysis_out(result.analysis),
        diagnostics=result.diagnostics,
    )
