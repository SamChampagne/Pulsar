"""Pydantic request / response schemas.

These schemas live in the API layer and are *separate* from the domain
entities. That separation lets us version the HTTP contract independently
of the internal model.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# -----------------------------------------------------------------------
# Input schemas
# -----------------------------------------------------------------------


class ResourceRequirementIn(BaseModel):
    resource_id: str
    units: int = Field(1, gt=0)


class MaterialRequirementIn(BaseModel):
    material_id: str
    quantity_per_unit: float = Field(0, ge=0)
    fixed_quantity: float = Field(0, ge=0)


class DependencyLinkIn(BaseModel):
    depends_on_id: str
    dependency_type: str = "finish_to_start"
    lag_minutes: int = 0
    max_wait_minutes: int | None = Field(default=None, ge=0)


class RoutingAlternativeIn(BaseModel):
    machine_id: str
    duration_minutes: int = Field(..., gt=0)
    setup_minutes: int = Field(0, ge=0)
    resource_requirements: list[ResourceRequirementIn] = Field(default_factory=list)


class LotSizingIn(BaseModel):
    """Lot-sizing policy: mode is 'none', 'fixed', or 'min_max'."""
    mode: str = "none"
    lot_size: int = Field(0, ge=0)
    min_lot_size: int = Field(0, ge=0)
    max_lot_size: int = Field(0, ge=0)


class OperationIn(BaseModel):
    id: str
    sequence: int = Field(..., ge=1)
    name: str
    duration_minutes: int = Field(..., gt=0)
    setup_minutes: int = Field(0, ge=0)
    eligible_machine_ids: list[str]
    dependencies: list[str] = Field(default_factory=list)
    dependency_links: list[DependencyLinkIn] = Field(default_factory=list)
    setup_family: str | None = None
    preemptible: bool = False
    min_chunk_minutes: int = Field(0, ge=0)
    resource_requirements: list[ResourceRequirementIn] = Field(default_factory=list)
    material_requirements: list[MaterialRequirementIn] = Field(default_factory=list)
    routings: list[RoutingAlternativeIn] = Field(default_factory=list)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    remaining_duration_minutes: int | None = Field(None, ge=0)
    firm_until: datetime | None = None
    frozen_until: datetime | None = None


class WorkOrderIn(BaseModel):
    id: str
    name: str
    product_id: str
    quantity: int = Field(..., gt=0)
    due_date: datetime
    release_date: datetime
    priority: int = Field(2, ge=1, le=4)
    # V1.2 Cas 2 — firm / forecast / tentative. Default "firm" keeps
    # legacy payloads backwards-compatible; a forecasting ERP pushes
    # "forecast" so the engine treats the lateness penalty lighter.
    firmness: str = Field(
        default="firm",
        pattern="^(firm|forecast|tentative)$",
    )
    operations: list[OperationIn]
    lot_sizing: LotSizingIn | None = None
    organization_id: str | None = None
    workspace_id: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "WO-RED",
                    "name": "WO-RED",
                    "product_id": "P-RED",
                    "quantity": 20,
                    "due_date": "2026-01-06T18:00:00",
                    "release_date": "2026-01-05T08:00:00",
                    "priority": 1,
                    "lot_sizing": {"mode": "fixed", "lot_size": 10},
                    "operations": [
                        {
                            "id": "RED-CUT",
                            "sequence": 1,
                            "name": "RED-CUT",
                            "duration_minutes": 80,
                            "eligible_machine_ids": ["CUT-1"],
                        },
                        {
                            "id": "RED-ASM",
                            "sequence": 2,
                            "name": "RED-ASM",
                            "duration_minutes": 90,
                            "eligible_machine_ids": ["ASM-1", "ASM-2"],
                            "dependencies": ["RED-CUT"],
                            "setup_family": "RED",
                            "resource_requirements": [
                                {"resource_id": "TOOL-KIT", "units": 1}
                            ],
                        },
                    ],
                }
            ]
        }
    }


class OrganizationIn(BaseModel):
    id: str
    name: str
    slug: str
    is_active: bool = True


class UserAccountIn(BaseModel):
    id: str
    email: str
    display_name: str
    is_active: bool = True
    # Real-auth slice 9: when present, hash with bcrypt and stamp the
    # new account so the planner can sign in right away. Optional so
    # admins can keep creating selector-login users in legacy mode.
    password: str | None = None


class MembershipIn(BaseModel):
    user_id: str
    role: str = "planner"
    is_active: bool = True


class WorkspaceAccessGrantIn(BaseModel):
    user_id: str
    is_active: bool = True


class AuthLoginIn(BaseModel):
    """Planner login.

    Carries the selector identity (user_id or email) plus the
    password when real-auth is enabled. The selector path is kept
    for back-compat in dev/local where settings.auth_require_password
    is False, but production deployments should always set the
    password field.
    """

    user_id: str | None = None
    email: str | None = None
    organization_id: str | None = None
    password: str | None = None


class AuthSwitchOrganizationIn(BaseModel):
    organization_id: str


class SetUserPasswordIn(BaseModel):
    """Real-auth slice 3: admin assigns a new password to a user.

    Keep it brief — the validation rules are deliberately weak (only a
    non-empty minimum) so a pilot operator can ship a temporary
    password to the planner via a side channel without the form
    rejecting common ASCII strings. Strength rules live on the user-
    facing self-service flow.
    """

    # Length is also enforced by check_password_policy in the route
    # handler so the rule lives in one place; this min_length=1 just
    # guards against a literal empty string getting through pydantic.
    password: str = Field(..., min_length=1)


class SetUserPasswordOut(BaseModel):
    user_id: str
    password_set: bool = True


class RevokeUserSessionsOut(BaseModel):
    user_id: str
    revoked_before: datetime
    sessions_revoked: bool = True


class SetupTransitionIn(BaseModel):
    from_family: str = Field(..., alias="from")
    to_family: str = Field(..., alias="to")
    minutes: int = Field(..., ge=0)

    model_config = {"populate_by_name": True}


class SetupMatrixIn(BaseModel):
    default_minutes: int = Field(0, ge=0)
    initial_minutes: int = Field(0, ge=0)
    transitions: list[SetupTransitionIn] = Field(default_factory=list)


class MaintenanceWindowIn(BaseModel):
    start: datetime
    end: datetime


class MachineIn(BaseModel):
    id: str
    name: str
    calendar_id: str
    capabilities: list[str] = Field(default_factory=list)
    efficiency: float = Field(1.0, gt=0)
    setup_matrix: SetupMatrixIn | None = None
    maintenance_windows: list[MaintenanceWindowIn] = Field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "ASM-1",
                    "name": "Assembly Cell 1",
                    "calendar_id": "CAL-REF",
                    "capabilities": ["assembly"],
                    "efficiency": 1.0,
                    "setup_matrix": {
                        "default_minutes": 20,
                        "initial_minutes": 10,
                        "transitions": [
                            {"from": "RED", "to": "BLUE", "minutes": 35}
                        ],
                    },
                    "maintenance_windows": [
                        {
                            "start": "2026-01-05T13:00:00",
                            "end": "2026-01-05T15:00:00",
                        }
                    ],
                }
            ]
        }
    }


class ResourceIn(BaseModel):
    id: str
    name: str
    capacity: int = Field(..., gt=0)
    calendar_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "TOOL-KIT",
                    "name": "Tool Kit",
                    "capacity": 1,
                    "tags": ["shared", "critical"],
                }
            ]
        }
    }


class InventoryItemIn(BaseModel):
    material_id: str
    quantity_on_hand: float = Field(..., ge=0)
    as_of: datetime | None = None
    organization_id: str | None = None
    workspace_id: str | None = None


class SupplyLotIn(BaseModel):
    id: str
    material_id: str
    quantity: float = Field(..., gt=0)
    available_at: datetime
    source_type: str = "supply"
    organization_id: str | None = None
    workspace_id: str | None = None


class WorkspaceIn(BaseModel):
    id: str
    name: str
    description: str = ""
    organization_id: str | None = None
    is_default: bool = False
    is_active: bool = True
    # V1.2 P2.4b — IANA plant timezone. Default UTC matches legacy
    # single-region behaviour; multi-region pilots set this per
    # workspace so drag-drop edits land at the plant's wall-clock
    # rather than the planner's browser TZ.
    plant_timezone: str = "UTC"


class ShiftIn(BaseModel):
    weekday: int = Field(..., ge=0, le=6)
    start: str  # HH:MM format
    end: str  # HH:MM format


class CalendarIn(BaseModel):
    id: str
    name: str
    shifts: list[ShiftIn] = Field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "CAL-REF",
                    "name": "Mon-Fri 08-17",
                    "shifts": [
                        {"weekday": 0, "start": "08:00", "end": "17:00"},
                        {"weekday": 1, "start": "08:00", "end": "17:00"},
                    ],
                }
            ]
        }
    }


class ObjectiveIn(BaseModel):
    """Multi-objective weights — all must be >= 0, at least one > 0."""

    makespan: int = Field(1, ge=0)
    total_tardiness: int = Field(10, ge=0)
    weighted_tardiness: int = Field(0, ge=0)
    setup_cost: int = Field(0, ge=0)
    idle_penalty: int = Field(0, ge=0)
    start_shift_penalty: int = Field(0, ge=0)
    machine_change_penalty: int = Field(0, ge=0)


# -----------------------------------------------------------------------
# Output schemas
# -----------------------------------------------------------------------


class MachineOut(BaseModel):
    id: str
    name: str
    calendar_id: str
    capabilities: list[str]
    efficiency: float
    setup_matrix: SetupMatrixOut | None = None
    maintenance_windows: list[MaintenanceWindowOut] = Field(default_factory=list)
    has_setup_matrix: bool = False
    maintenance_window_count: int = 0
    organization_id: str | None = None
    workspace_id: str | None = None


class ResourceOut(BaseModel):
    id: str
    name: str
    capacity: int
    calendar_id: str | None = None
    tags: list[str]
    organization_id: str | None = None
    workspace_id: str | None = None


class InventoryItemOut(BaseModel):
    material_id: str
    quantity_on_hand: float
    as_of: datetime | None = None
    organization_id: str | None = None
    workspace_id: str | None = None


class SupplyLotOut(BaseModel):
    id: str
    material_id: str
    quantity: float
    available_at: datetime
    source_type: str = "supply"
    organization_id: str | None = None
    workspace_id: str | None = None


class WorkspaceOut(BaseModel):
    id: str
    name: str
    description: str = ""
    organization_id: str | None = None
    is_default: bool = False
    is_active: bool = True
    plant_timezone: str = "UTC"


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    is_active: bool = True


class UserAccountOut(BaseModel):
    id: str
    email: str
    display_name: str
    is_active: bool = True


class MembershipOut(BaseModel):
    organization_id: str
    user_id: str
    role: str
    is_active: bool = True


class WorkspaceAccessGrantOut(BaseModel):
    organization_id: str
    workspace_id: str
    user_id: str
    is_active: bool = True


class AuthCompanyMembershipOut(BaseModel):
    organization: OrganizationOut
    membership: MembershipOut
    workspaces: list[WorkspaceOut] = Field(default_factory=list)


class AuthLoginDirectoryOut(BaseModel):
    users: list[UserAccountOut] = Field(default_factory=list)
    organizations: list[OrganizationOut] = Field(default_factory=list)
    memberships: list[MembershipOut] = Field(default_factory=list)
    # Real-auth slice 2: lets the UI decide whether to render the
    # password input. Stays False on selector-only deployments so the
    # legacy login flow keeps working unchanged.
    password_required: bool = False


class AuthContextOut(BaseModel):
    authenticated: bool
    auth_mode: str = "anonymous"
    user: UserAccountOut | None = None
    active_organization: OrganizationOut | None = None
    active_membership: MembershipOut | None = None
    memberships: list[AuthCompanyMembershipOut] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    session_token: str | None = None
    session_expires_at: datetime | None = None


class AuthLogoutOut(BaseModel):
    authenticated: bool = False
    auth_mode: str = "anonymous"
    message: str = "Logged out locally."


class ShiftOut(BaseModel):
    weekday: int
    start: str
    end: str


class CalendarOut(BaseModel):
    id: str
    name: str
    organization_id: str | None = None
    workspace_id: str | None = None
    shifts: list[ShiftOut]


class ResourceRequirementOut(BaseModel):
    resource_id: str
    units: int


class MaterialRequirementOut(BaseModel):
    material_id: str
    quantity_per_unit: float
    fixed_quantity: float


class DependencyLinkOut(BaseModel):
    depends_on_id: str
    dependency_type: str
    lag_minutes: int = 0
    max_wait_minutes: int | None = None


class RoutingAlternativeOut(BaseModel):
    machine_id: str
    duration_minutes: int
    setup_minutes: int = 0
    resource_requirements: list[ResourceRequirementOut] = Field(default_factory=list)


class LotSizingOut(BaseModel):
    mode: str = "none"
    lot_size: int = 0
    min_lot_size: int = 0
    max_lot_size: int = 0


class OperationOut(BaseModel):
    id: str
    sequence: int
    name: str
    duration_minutes: int
    setup_minutes: int = 0
    eligible_machine_ids: list[str]
    dependencies: list[str] = Field(default_factory=list)
    dependency_links: list[DependencyLinkOut] = Field(default_factory=list)
    status: str
    setup_family: str | None = None
    preemptible: bool = False
    min_chunk_minutes: int = 0
    resource_requirements: list[ResourceRequirementOut] = Field(default_factory=list)
    material_requirements: list[MaterialRequirementOut] = Field(default_factory=list)
    routings: list[RoutingAlternativeOut] = Field(default_factory=list)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    actual_consumed_minutes: int | None = None
    remaining_duration_minutes: int | None = None
    planned_remaining_minutes: int | None = None
    wip_repair_mode: str | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None


class WorkOrderOut(BaseModel):
    id: str
    name: str
    product_id: str
    quantity: int
    due_date: datetime
    release_date: datetime
    priority: int
    status: str
    firmness: str = "firm"
    lot_sizing: LotSizingOut | None = None
    operations: list[OperationOut] = Field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None


class SetupTransitionOut(BaseModel):
    from_family: str = Field(..., alias="from")
    to_family: str = Field(..., alias="to")
    minutes: int

    model_config = {"populate_by_name": True}


class SetupMatrixOut(BaseModel):
    default_minutes: int = 0
    initial_minutes: int = 0
    transitions: list[SetupTransitionOut] = Field(default_factory=list)


class MaintenanceWindowOut(BaseModel):
    start: datetime
    end: datetime


class ScheduledOperationOut(BaseModel):
    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime


class GanttEntryOut(BaseModel):
    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int


class GanttSegmentOut(BaseModel):
    start: datetime
    end: datetime
    segment_type: str = "run"


class GanttOperationItemOut(BaseModel):
    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    operation_name: str | None = None
    work_order_name: str | None = None
    machine_name: str | None = None
    product_id: str | None = None
    sequence: int | None = None
    release_date: datetime | None = None
    due_date: datetime | None = None
    priority: int | None = None
    status: str | None = None
    execution_status: str = "not_started"
    planning_lock: str = "free"
    planning_zone: str = "liquid"
    movable: bool = True
    override_required: bool = False
    lock_reason: str = "Operation is free for interactive planning."
    required_override_action: str | None = None
    override_policy: dict[str, Any] = Field(default_factory=dict)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    actual_consumed_minutes: int | None = None
    remaining_duration_minutes: int | None = None
    planned_remaining_minutes: int | None = None
    wip_repair_mode: str | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None
    setup_family: str | None = None
    eligible_machine_ids: list[str] = Field(default_factory=list)
    resource_requirement_ids: list[str] = Field(default_factory=list)
    material_requirement_ids: list[str] = Field(default_factory=list)
    dependency_ids: list[str] = Field(default_factory=list)
    segments: list[GanttSegmentOut] = Field(default_factory=list)
    editable_actions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    is_late: bool = False
    is_critical: bool = False
    is_preempted: bool = False
    baseline_machine_id: str | None = None
    baseline_start: datetime | None = None
    baseline_end: datetime | None = None
    changed_from_baseline: bool = False
    start_delta_minutes: int | None = None


class GanttMachineLaneOut(BaseModel):
    machine_id: str
    machine_name: str | None = None
    calendar_id: str | None = None
    assignment_count: int
    setup_minutes: int
    run_minutes: int
    first_start: datetime | None = None
    last_end: datetime | None = None


class GanttWorkOrderLaneOut(BaseModel):
    work_order_id: str
    work_order_name: str | None = None
    product_id: str | None = None
    release_date: datetime | None = None
    due_date: datetime | None = None
    priority: int | None = None
    status: str | None = None
    operation_count: int
    scheduled_operation_count: int
    is_late: bool
    firmness: str = "firm"


class MachineUtilizationOut(BaseModel):
    machine_id: str
    busy_minutes: int
    setup_minutes: int
    idle_minutes: int
    utilization: float
    num_operations: int


class FlowTimeOut(BaseModel):
    work_order_id: str
    flow_time_minutes: int
    tardiness_minutes: int
    is_on_time: bool


class CriticalPathOut(BaseModel):
    operations: list[str]
    total_minutes: int
    work_orders: list[str]


class BottleneckOut(BaseModel):
    machine_id: str
    utilization: float


class AnalysisOut(BaseModel):
    critical_path: CriticalPathOut
    bottleneck: BottleneckOut
    flow_times: list[FlowTimeOut]
    machine_utilization: list[MachineUtilizationOut]
    gantt: list[GanttEntryOut]


class ScheduleSummaryOut(BaseModel):
    scheduled_operation_count: int
    work_order_count: int
    makespan_minutes: int | None = None
    total_lateness_minutes: int | None = None
    on_time_ratio: float | None = None
    late_work_order_ids: list[str] = Field(default_factory=list)
    bottleneck_machine_id: str | None = None
    bottleneck_utilization: float | None = None
    critical_path_minutes: int | None = None
    critical_path_operation_ids: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)


class FeasibilityIssueOut(BaseModel):
    kind: str
    severity: str
    message: str
    operation_id: str | None = None
    work_order_id: str | None = None
    machine_id: str | None = None


class RelaxationSuggestionOut(BaseModel):
    action: str
    impact: str
    priority: int
    issue_kind: str | None = None
    target_ids: list[str] = Field(default_factory=list)
    rationale: str | None = None
    expected_mode: str | None = None


class FeasibilityReportOut(BaseModel):
    is_feasible: bool
    error_count: int
    warning_count: int
    readiness_status: str
    recommended_mode: str
    dominant_issue_kind: str | None = None
    next_best_action: str | None = None
    planner_focus: str
    issues: list[FeasibilityIssueOut]
    suggestions: list[RelaxationSuggestionOut]


# -----------------------------------------------------------------------
# Scheduling run
# -----------------------------------------------------------------------


class TransferTimePairIn(BaseModel):
    from_machine: str
    to_machine: str
    minutes: int = Field(..., ge=0)


class TransferTimesIn(BaseModel):
    default_minutes: int = Field(0, ge=0)
    pairs: list[TransferTimePairIn] = Field(default_factory=list)


class PlannerActionIn(BaseModel):
    action_type: str
    operation_id: str | None = None
    work_order_id: str | None = None
    machine_id: str | None = None
    calendar_id: str | None = None
    due_date: datetime | None = None
    setup_start: datetime | None = None
    start: datetime | None = None
    end: datetime | None = None
    priority: int | str | None = None
    reason: str | None = None


class PlanningEditIn(BaseModel):
    edit_type: str
    operation_id: str | None = None
    work_order_id: str | None = None
    machine_id: str | None = None
    calendar_id: str | None = None
    due_date: datetime | None = None
    setup_start: datetime | None = None
    start: datetime | None = None
    end: datetime | None = None
    priority: int | str | None = None
    reason: str | None = None
    anchor_mode: str = "repair_local"
    force_assignment: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunScheduleRequest(BaseModel):
    horizon_start: datetime | None = None
    horizon_days: int = Field(30, gt=0, le=365)
    heuristic: str = "edd"
    strategy: str = "greedy"
    reschedule_mode: str = "reschedule_all"
    objective: ObjectiveIn | None = None
    transfer_times: TransferTimesIn | None = None
    persist: bool = True
    workspace_id: str | None = None
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    baseline_schedule_id: str | None = None
    planner_actions: list[PlannerActionIn] = Field(default_factory=list)
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "horizon_start": "2026-01-05T00:00:00",
                    "horizon_days": 5,
                    "heuristic": "edd",
                    "strategy": "greedy",
                    "persist": True,
                    "transfer_times": {
                        "default_minutes": 0,
                        "pairs": [
                            {
                                "from_machine": "CUT-1",
                                "to_machine": "ASM-1",
                                "minutes": 20,
                            }
                        ],
                    },
                }
            ]
        }
    }


class RunScheduleResponse(BaseModel):
    schedule_id: str
    created_at: datetime
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    organization_id: str | None = None
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    input_snapshot_hash: str = ""
    engine_version: str = "aps-engine.v1"
    strategy: str
    solver_status: str
    objective_value: int
    wall_time_ms: int
    assignments: list[ScheduledOperationOut]
    metrics: dict[str, Any]
    summary: ScheduleSummaryOut | None = None
    analysis: AnalysisOut | None = None
    feasibility: FeasibilityReportOut | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class StrategyCapabilityOut(BaseModel):
    name: str
    label: str
    description: str
    kind: str = "solver"
    maturity: str
    planning_mode: str
    optimization_mode: str
    recommended_for_disruption: bool
    supports_secondary_resources: bool
    supports_transfer_times: bool
    supports_routings: bool
    supports_setup_matrix: bool
    supports_maintenance_windows: bool
    supports_preemption: bool
    supports_frozen_assignments: bool
    notes: list[str] = Field(default_factory=list)
    registered: bool = True
    available: bool = True
    availability_reason: str | None = None
    ui_groups: list[str] = Field(default_factory=list)
    default_for_baseline: bool = False


class StrategyCapabilitiesResponse(BaseModel):
    version: str = "strategy-capabilities-v1"
    default_strategy: str = "auto"
    strategies: list[StrategyCapabilityOut]


class PreviewPlanningEditsRequest(BaseModel):
    edits: list[PlanningEditIn] = Field(..., min_length=1)
    horizon_start: datetime | None = None
    horizon_days: int = Field(30, gt=0, le=365)
    heuristic: str = "edd"
    strategy: str = "auto"
    reschedule_mode: str = "repair_local"
    objective: ObjectiveIn | None = None
    transfer_times: TransferTimesIn | None = None
    workspace_id: str | None = None
    scenario_name: str = "Interactive preview"
    lifecycle_status: str = "simulation"


class PreviewPlanningEditsResponse(BaseModel):
    baseline_schedule_id: str
    planner_actions: list[PlannerActionIn]
    unsupported_edits: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    planner_guidance: dict[str, Any] = Field(default_factory=dict)
    preview: RunScheduleResponse
    gantt: ScheduleGanttResponse


class ApplyPlanningEditsRequest(PreviewPlanningEditsRequest):
    scenario_name: str = "Interactive candidate"
    lifecycle_status: str = "draft"


class ApplyPlanningEditsResponse(BaseModel):
    baseline_schedule_id: str
    candidate_schedule_id: str
    planner_actions: list[PlannerActionIn]
    unsupported_edits: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    planner_guidance: dict[str, Any] = Field(default_factory=dict)
    candidate: RunScheduleResponse
    gantt: ScheduleGanttResponse


class ReplayScheduleRunRequest(BaseModel):
    strategy: str | None = None


class ReplayScheduleRunResponse(BaseModel):
    original_schedule_id: str
    input_snapshot_hash: str
    replay_matches_original: bool
    hash_matches: bool = True
    strategy_matches: bool = True
    objective_matches: bool = True
    assignment_delta: dict[str, Any]
    metrics_delta: dict[str, Any] = Field(default_factory=dict)
    divergence_reasons: list[str] = Field(default_factory=list)
    replay_report: dict[str, Any] = Field(default_factory=dict)
    replay: RunScheduleResponse


class CapableToPromiseRequest(BaseModel):
    candidate_order: WorkOrderIn
    horizon_start: datetime | None = None
    horizon_days: int = Field(30, gt=0, le=365)
    strategy: str = "infinite"
    finite_validation: bool = False
    finite_strategy: str = "greedy"
    promise_dates: list[datetime] = Field(default_factory=list)
    objective: ObjectiveIn | None = None
    transfer_times: TransferTimesIn | None = None
    workspace_id: str | None = None


class QuantityAvailabilityOut(BaseModel):
    date: datetime
    available_quantity: int
    short_quantity: int
    requested_quantity: int
    is_full_quantity_available: bool
    promise_delta_minutes: int | None = None
    mode: str = "all_or_none"


class RoughCutCapacityBucketOut(BaseModel):
    machine_id: str
    date: str
    capacity_minutes: int
    baseline_load_minutes: int
    new_load_minutes: int
    candidate_load_minutes: int
    load_delta_minutes: int
    rough_utilization: float | None = None
    overlap_count: int
    pressure: str


class CapableToPromiseResponse(BaseModel):
    feasible: bool
    strategy: str
    solver_status: str
    earliest_completion: datetime | None
    due_date: datetime
    promise_delta_minutes: int | None
    assignments: list[ScheduledOperationOut]
    metrics: dict[str, Any]
    insertion_impact: dict[str, Any]
    available_quantity_by_date: list[QuantityAvailabilityOut]
    rough_cut_capacity: list[RoughCutCapacityBucketOut]
    planner_explanation: dict[str, Any]
    recommendation: str
    finite_validation: dict[str, Any] | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class PlannerReadinessResponse(BaseModel):
    schedule_id: str
    status: str
    ready: bool
    recommendation: str
    blockers: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    ui_contract: dict[str, Any] = Field(default_factory=dict)


class UpdateScheduleContextRequest(BaseModel):
    workspace_id: str | None = None
    scenario_name: str | None = None
    lifecycle_status: str | None = None


# -----------------------------------------------------------------------
# Scenario management
# -----------------------------------------------------------------------


class CompareScenariosRequest(BaseModel):
    baseline_schedule_id: str
    candidate_schedule_ids: list[str] = Field(..., min_length=1)
    max_operation_changes: int = Field(25, gt=0, le=1_000)


class CompareScenariosResponse(BaseModel):
    baseline: dict[str, Any]
    comparisons: list[dict[str, Any]]
    recommended_schedule_id: str | None = None
    publishable_schedule_ids: list[str] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)


class PublishScenarioRequest(BaseModel):
    baseline_schedule_id: str | None = None
    scenario_name: str | None = None
    allow_review: bool = False


class PublishScenarioResponse(BaseModel):
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    publish_status: str
    recommendation: str
    comparison: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# -----------------------------------------------------------------------
# Planning control plane
# -----------------------------------------------------------------------


class PlanningScheduleRefOut(BaseModel):
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    workspace_id: str
    organization_id: str | None = None
    strategy: str
    solver_status: str
    objective_value: int
    created_at: datetime
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    input_snapshot_hash: str = ""
    engine_version: str = "aps-engine.v1"


class PlanningEventOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str
    event_type: str
    schedule_id: str | None = None
    baseline_schedule_id: str | None = None
    candidate_schedule_id: str | None = None
    source_schedule_id: str | None = None
    edit_count: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: str | None = None
    created_at: datetime


class PlanningStateResponse(BaseModel):
    organization_id: str | None = None
    workspace_id: str
    active_baseline_schedule_id: str | None = None
    active_candidate_schedule_id: str | None = None
    candidate_status: str = "none"
    candidate_edit_count: int = 0
    last_event_type: str | None = None
    updated_by_user_id: str | None = None
    updated_at: datetime | None = None
    active_baseline: PlanningScheduleRefOut | None = None
    active_candidate: PlanningScheduleRefOut | None = None
    recent_events: list[PlanningEventOut] = Field(default_factory=list)


class SelectPlanningBaselineRequest(BaseModel):
    schedule_id: str
    workspace_id: str | None = None
    scenario_name: str | None = None


class DiscardPlanningCandidateRequest(BaseModel):
    workspace_id: str | None = None
    candidate_schedule_id: str | None = None
    reason: str | None = None


# -----------------------------------------------------------------------
# Compare strategies
# -----------------------------------------------------------------------


class CompareStrategiesRequest(BaseModel):
    strategies: list[str] = Field(
        default=["greedy", "backward", "sa", "tabu"],
        min_length=1,
    )
    horizon_start: datetime | None = None
    horizon_days: int = Field(30, gt=0, le=365)
    objective: ObjectiveIn | None = None
    transfer_times: TransferTimesIn | None = None
    baseline_schedule_id: str | None = None
    workspace_id: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "horizon_start": "2026-01-05T00:00:00",
                    "horizon_days": 5,
                    "strategies": ["greedy", "backward", "cpsat"],
                    "transfer_times": {
                        "default_minutes": 0,
                        "pairs": [
                            {
                                "from_machine": "CUT-1",
                                "to_machine": "ASM-1",
                                "minutes": 20,
                            }
                        ],
                    },
                }
            ]
        }
    }


class StrategyComparisonOut(BaseModel):
    strategy: str
    solver_status: str
    objective_value: int | None
    wall_time_ms: int
    metrics: dict[str, Any]
    summary: ScheduleSummaryOut | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    infeasibility: dict[str, Any] | None = None
    profile: dict[str, Any] | None = None
    error: str | None = None


class ComparisonSummaryOut(BaseModel):
    best_strategy: str | None = None
    fastest_strategy: str | None = None
    successful_runs: int
    most_stable_strategy: str | None = None
    shortest_makespan_strategy: str | None = None
    lowest_lateness_strategy: str | None = None
    best_on_time_ratio_strategy: str | None = None
    failed_strategies: list[str] = Field(default_factory=list)
    infeasible_strategies: list[str] = Field(default_factory=list)
    error_strategies: list[str] = Field(default_factory=list)
    objective_spread: int | None = None
    dominant_failure_kind: str | None = None
    next_best_recovery_action: str | None = None
    planner_focus: str | None = None
    qualified_strategies: list[str] = Field(default_factory=list)
    experimental_strategies: list[str] = Field(default_factory=list)
    recommended_for_disruption: str | None = None
    recommended_for_what_if: str | None = None
    recommended_for_just_in_time: str | None = None
    qualification_highlights: list[str] = Field(default_factory=list)
    qualification_cards: list[dict[str, Any]] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    tradeoff_cards: list[dict[str, Any]] = Field(default_factory=list)
    failure_cards: list[dict[str, Any]] = Field(default_factory=list)


class CompareStrategiesResponse(BaseModel):
    best_strategy: str | None
    summary: ComparisonSummaryOut | None = None
    runs: list[StrategyComparisonOut]


# -----------------------------------------------------------------------
# Disruption handler
# -----------------------------------------------------------------------


class DisruptionEventIn(BaseModel):
    disruption_type: str  # "machine_down", "rush_order", "operation_delay"
    timestamp: datetime
    machine_id: str | None = None
    event_end: datetime | None = None
    operation_id: str | None = None
    new_end: datetime | None = None
    rush_order: WorkOrderIn | None = None


class HandleDisruptionRequest(BaseModel):
    event: DisruptionEventIn
    schedule_id: str
    horizon_days: int = Field(30, gt=0, le=365)
    strategy: str = "greedy"
    reschedule_mode: str = "repair_local"
    objective: ObjectiveIn | None = None
    transfer_times: TransferTimesIn | None = None
    persist: bool = True
    workspace_id: str | None = None
    scenario_name: str | None = None
    lifecycle_status: str | None = None
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "schedule_id": "schedule-20260105-001",
                    "strategy": "greedy",
                    "persist": True,
                    "event": {
                        "disruption_type": "machine_down",
                        "timestamp": "2026-01-05T12:00:00",
                        "machine_id": "ASM-1",
                        "event_end": "2026-01-05T17:00:00",
                    },
                }
            ]
        }
    }


class ApiErrorResponse(BaseModel):
    error: str
    message: str
    details: list[dict[str, Any]] | None = None


class HandleDisruptionResponse(BaseModel):
    schedule_id: str
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    reschedule_mode: str = "repair_local"
    frozen_count: int
    rescheduled_count: int
    strategy: str
    solver_status: str
    objective_value: int
    wall_time_ms: int
    assignments: list[ScheduledOperationOut]
    metrics: dict[str, Any]
    summary: ScheduleSummaryOut | None = None
    analysis: AnalysisOut | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)


# -----------------------------------------------------------------------
# Schedule dashboard / KPIs
# -----------------------------------------------------------------------


class DashboardResponse(BaseModel):
    schedule_id: str
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    work_order_count: int
    operation_count: int
    machine_count: int
    metrics: dict[str, Any]
    summary: ScheduleSummaryOut | None = None
    analysis: AnalysisOut | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    strategy: str = "unknown"
    solver_status: str = "unknown"
    objective_value: int = 0
    wall_time_ms: int = 0


class MachineCapacityBucketOut(BaseModel):
    machine_id: str
    machine_name: str | None = None
    calendar_id: str | None = None
    bucket_start: datetime
    bucket_end: datetime
    capacity_minutes: int
    scheduled_load_minutes: int
    setup_minutes: int
    run_minutes: int
    idle_minutes: int
    overload_minutes: int
    utilization: float | None = None
    operation_count: int
    overlap_count: int
    pressure: str
    baseline_load_minutes: int = 0
    candidate_load_minutes: int = 0
    load_delta_minutes: int = 0
    capacity_units: int = 1


class MachineCapacitySummaryOut(BaseModel):
    machine_id: str
    machine_name: str | None = None
    calendar_id: str | None = None
    capacity_minutes: int
    scheduled_load_minutes: int
    setup_minutes: int
    run_minutes: int
    idle_minutes: int
    overload_minutes: int
    utilization: float | None = None
    peak_utilization: float | None = None
    operation_count: int
    overlap_count: int
    bucket_count: int
    pressure: str
    bottleneck: bool = False
    capacity_units: int = 1


class MachineCapacityResponse(BaseModel):
    schedule_id: str
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    organization_id: str | None = None
    horizon_start: datetime
    horizon_end: datetime
    bucket: str
    status: str
    generated_at: datetime
    total_capacity_minutes: int
    total_scheduled_load_minutes: int
    total_setup_minutes: int
    total_run_minutes: int
    total_idle_minutes: int
    total_overload_minutes: int
    average_utilization: float | None = None
    peak_utilization: float | None = None
    bottleneck_machine_id: str | None = None
    machines: list[MachineCapacitySummaryOut] = Field(default_factory=list)
    buckets: list[MachineCapacityBucketOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    contract_version: str = "machine-capacity-ledger-v1"


class ScheduleGanttResponse(BaseModel):
    schedule_id: str
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    organization_id: str | None = None
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    strategy: str = "unknown"
    solver_status: str = "unknown"
    input_snapshot_hash: str = ""
    engine_version: str = "aps-engine.v1"
    baseline_schedule_id: str | None = None
    machine_lanes: list[GanttMachineLaneOut] = Field(default_factory=list)
    work_order_lanes: list[GanttWorkOrderLaneOut] = Field(default_factory=list)
    items: list[GanttOperationItemOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    interaction_contract: dict[str, Any] = Field(default_factory=dict)


class ScheduleRiskOperationOut(BaseModel):
    operation_id: str
    work_order_id: str
    machine_id: str
    start: datetime
    end: datetime
    due_date: datetime | None = None
    severity: str
    reasons: list[str] = Field(default_factory=list)
    lateness_minutes: int = 0


class ScheduleRiskWorkOrderOut(BaseModel):
    work_order_id: str
    work_order_name: str | None = None
    due_date: datetime | None = None
    severity: str
    operation_count: int
    late_operation_count: int
    critical_operation_count: int
    last_end: datetime | None = None
    reasons: list[str] = Field(default_factory=list)


class ScheduleRiskMachinePressureOut(BaseModel):
    machine_id: str
    machine_name: str | None = None
    assignment_count: int
    load_minutes: int
    utilization: float
    pressure: str
    late_count: int
    critical_count: int


class ScheduleRiskConstraintOut(BaseModel):
    operation_id: str
    work_order_id: str
    machine_id: str
    planning_lock: str
    planning_zone: str
    move_policy: str
    severity: str
    reason: str


class ScheduleRiskActionOut(BaseModel):
    action: str
    label: str
    reason: str
    priority: int
    target_ids: list[str] = Field(default_factory=list)


class ScheduleRiskResponse(BaseModel):
    schedule_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime
    status: str
    risk_score: int
    summary: dict[str, int | float | str | None] = Field(default_factory=dict)
    late_operations: list[ScheduleRiskOperationOut] = Field(default_factory=list)
    critical_operations: list[ScheduleRiskOperationOut] = Field(default_factory=list)
    at_risk_work_orders: list[ScheduleRiskWorkOrderOut] = Field(default_factory=list)
    machine_pressure: list[ScheduleRiskMachinePressureOut] = Field(default_factory=list)
    firm_frozen_constraints: list[ScheduleRiskConstraintOut] = Field(default_factory=list)
    recommended_actions: list[ScheduleRiskActionOut] = Field(default_factory=list)


class SuggestedOperationSlotOut(BaseModel):
    rank: int
    machine_id: str
    machine_name: str | None = None
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    material_ready_at: datetime | None = None
    resource_checked: bool = False
    score: int = 0
    baseline_start_delta_minutes: int | None = None
    baseline_machine_change: bool = False
    score_components: dict[str, int] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)


class SlotMachineRejectionOut(BaseModel):
    machine_id: str
    reason: str
    blocker: str


class SuggestOperationSlotsResponse(BaseModel):
    schedule_id: str
    operation_id: str
    generated_at: datetime
    horizon_start: datetime
    horizon_end: datetime
    baseline_assignment: dict[str, Any] | None = None
    slots: list[SuggestedOperationSlotOut] = Field(default_factory=list)
    rejected_machines: list[SlotMachineRejectionOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    interaction_contract: dict[str, Any] = Field(default_factory=dict)


# -----------------------------------------------------------------------
# Canonical integration contract
# -----------------------------------------------------------------------


class CanonicalShiftSchema(BaseModel):
    weekday: int = Field(..., ge=0, le=6)
    start: str
    end: str


class CanonicalTimeWindowSchema(BaseModel):
    start: datetime
    end: datetime


class CanonicalCalendarSchema(BaseModel):
    id: str
    name: str
    shifts: list[CanonicalShiftSchema] = Field(default_factory=list)
    external_ref: str | None = None
    site_id: str | None = None


class CanonicalSetupTransitionSchema(BaseModel):
    from_family: str = Field(..., alias="from")
    to_family: str = Field(..., alias="to")
    minutes: int = Field(..., ge=0)

    model_config = {"populate_by_name": True}


class CanonicalSetupMatrixSchema(BaseModel):
    default_minutes: int = Field(0, ge=0)
    initial_minutes: int = Field(0, ge=0)
    transitions: list[CanonicalSetupTransitionSchema] = Field(default_factory=list)


class CanonicalMachineSchema(BaseModel):
    id: str
    name: str
    calendar_id: str
    capabilities: list[str] = Field(default_factory=list)
    efficiency: float = Field(1.0, gt=0)
    setup_matrix: CanonicalSetupMatrixSchema | None = None
    maintenance_windows: list[CanonicalTimeWindowSchema] = Field(default_factory=list)
    external_ref: str | None = None
    site_id: str | None = None


class CanonicalResourceSchema(BaseModel):
    id: str
    name: str
    capacity: int = Field(..., gt=0)
    calendar_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    external_ref: str | None = None
    site_id: str | None = None


class CanonicalResourceRequirementSchema(BaseModel):
    resource_id: str
    units: int = Field(1, gt=0)


class CanonicalMaterialRequirementSchema(BaseModel):
    material_id: str
    quantity_per_unit: float = Field(0, ge=0)
    fixed_quantity: float = Field(0, ge=0)


class CanonicalDependencyLinkSchema(BaseModel):
    depends_on_id: str
    dependency_type: str = "finish_to_start"
    lag_minutes: int = 0
    max_wait_minutes: int | None = Field(default=None, ge=0)


class CanonicalRoutingAlternativeSchema(BaseModel):
    machine_id: str
    duration_minutes: int = Field(..., gt=0)
    setup_minutes: int = Field(0, ge=0)
    resource_requirements: list[CanonicalResourceRequirementSchema] = Field(default_factory=list)


class CanonicalOperationSchema(BaseModel):
    id: str
    work_order_id: str
    sequence: int = Field(..., ge=1)
    name: str
    duration_minutes: int = Field(..., gt=0)
    eligible_machine_ids: list[str]
    setup_minutes: int = Field(0, ge=0)
    dependencies: list[str] = Field(default_factory=list)
    dependency_links: list[CanonicalDependencyLinkSchema] = Field(default_factory=list)
    status: str = "pending"
    setup_family: str | None = None
    resource_requirements: list[CanonicalResourceRequirementSchema] = Field(default_factory=list)
    material_requirements: list[CanonicalMaterialRequirementSchema] = Field(default_factory=list)
    routings: list[CanonicalRoutingAlternativeSchema] = Field(default_factory=list)
    preemptible: bool = False
    min_chunk_minutes: int = Field(0, ge=0)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    remaining_duration_minutes: int | None = Field(None, ge=0)
    firm_until: datetime | None = None
    frozen_until: datetime | None = None
    external_ref: str | None = None


class CanonicalLotSizingSchema(BaseModel):
    mode: str = "none"
    lot_size: int = Field(0, ge=0)
    min_lot_size: int = Field(0, ge=0)
    max_lot_size: int = Field(0, ge=0)


class CanonicalWorkOrderSchema(BaseModel):
    id: str
    name: str
    product_id: str
    quantity: int = Field(..., gt=0)
    due_date: datetime
    release_date: datetime
    operations: list[CanonicalOperationSchema]
    priority: str = "normal"
    status: str = "released"
    # V1.2 Cas 2 — firm / forecast / tentative. Validated against
    # WorkOrderFirmness when the snapshot is materialised; the
    # pattern keeps the API rejection cheap.
    firmness: str = Field(default="firm", pattern="^(firm|forecast|tentative)$")
    lot_sizing: CanonicalLotSizingSchema = Field(default_factory=CanonicalLotSizingSchema)
    external_ref: str | None = None
    site_id: str | None = None
    item_id: str | None = None
    quantity_uom: str = "ea"
    requested_date: datetime | None = None
    promised_date: datetime | None = None
    erp_status: str | None = None
    order_type: str = "production"


class CanonicalTransferTimePairSchema(BaseModel):
    from_machine: str
    to_machine: str
    minutes: int = Field(..., ge=0)


class CanonicalTransferTimesSchema(BaseModel):
    default_minutes: int = Field(0, ge=0)
    pairs: list[CanonicalTransferTimePairSchema] = Field(default_factory=list)


class CanonicalInventoryItemSchema(BaseModel):
    material_id: str
    quantity_on_hand: float = Field(..., ge=0)
    as_of: datetime | None = None


class CanonicalSupplyLotSchema(BaseModel):
    id: str
    material_id: str
    quantity: float = Field(..., gt=0)
    available_at: datetime
    source_type: str = "supply"


class CanonicalPlanningSnapshotSchema(BaseModel):
    contract_version: str
    exported_at: datetime
    source_system: str
    calendars: list[CanonicalCalendarSchema] = Field(default_factory=list)
    machines: list[CanonicalMachineSchema] = Field(default_factory=list)
    resources: list[CanonicalResourceSchema] = Field(default_factory=list)
    work_orders: list[CanonicalWorkOrderSchema] = Field(default_factory=list)
    inventory_items: list[CanonicalInventoryItemSchema] = Field(default_factory=list)
    supplies: list[CanonicalSupplyLotSchema] = Field(default_factory=list)
    transfer_times: CanonicalTransferTimesSchema = Field(default_factory=CanonicalTransferTimesSchema)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalCsvBundleRequest(BaseModel):
    calendars_csv: str
    machines_csv: str = ""
    work_orders_csv: str = ""
    operations_csv: str = ""
    source_system: str = "csv"
    exported_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalValidationResponse(BaseModel):
    contract_version: str
    source_system: str
    valid: bool
    readiness_status: str = "ready"
    error_count: int = 0
    warning_count: int = 0
    calendar_count: int
    machine_count: int
    resource_count: int
    work_order_count: int
    operation_count: int
    issues: list[CanonicalValidationIssueOut] = Field(default_factory=list)


class CanonicalValidationIssueOut(BaseModel):
    kind: str
    severity: str
    message: str
    entity_type: str | None = None
    entity_id: str | None = None
    field: str | None = None
    reference: str | None = None
    source_file: str | None = None
    source_row: int | None = None


class CanonicalImportResponse(BaseModel):
    source_system: str
    imported_at: datetime
    created: dict[str, int]
    updated: dict[str, int]
    binding_count: int
    validation: dict[str, Any] = Field(default_factory=dict)


class IntegrationJournalEntryOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    action: str
    source_system: str
    status: str
    valid: bool
    error_count: int = 0
    warning_count: int = 0
    entity_counts: dict[str, int] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class IntegrationExecutionOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    execution_kind: str
    target_type: str
    target_id: str | None = None
    target_name: str | None = None
    source_system: str
    status: str
    valid: bool
    trigger_type: str | None = None
    actor_mode: str | None = None
    actor_id: str | None = None
    correlation_id: str | None = None
    attempt_number: int = 1
    message: str = ""
    error_code: str | None = None
    entity_counts: dict[str, int] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)
    journal_entry_id: str | None = None
    started_at: datetime
    finished_at: datetime
    duration_ms: int = 0


class IntegrationApiClientIn(BaseModel):
    name: str
    scopes: list[str] = Field(default_factory=lambda: ["read"])
    workspace_id: str | None = None
    source_system: str | None = None
    expires_at: datetime | None = None


class IntegrationApiClientOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    name: str
    source_system: str | None = None
    key_prefix: str
    scopes: list[str] = Field(default_factory=list)
    is_active: bool
    created_by_user_id: str | None = None
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class IntegrationApiClientCreateResponse(BaseModel):
    client: IntegrationApiClientOut
    api_key: str


class IntegrationConnectorIn(BaseModel):
    name: str
    endpoint_url: str
    source_system: str
    workspace_id: str | None = None
    connector_type: str = "http"
    method: str = "POST"
    auth_type: str = "none"
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    secret_value: str | None = None
    credential_id: str | None = None
    static_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int = Field(30, gt=0, le=300)
    is_enabled: bool = True


class IntegrationConnectorPatch(BaseModel):
    """Partial update — only the fields the caller actually sends are touched.

    `connector_type`, organization and workspace scope are immutable; mutating
    them would orphan the flow blocks already pointing at this connector id.
    """

    name: str | None = None
    endpoint_url: str | None = None
    source_system: str | None = None
    method: str | None = None
    auth_type: str | None = None
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    secret_value: str | None = None
    credential_id: str | None = None
    static_headers: dict[str, str] | None = None
    timeout_seconds: int | None = Field(None, gt=0, le=300)
    is_enabled: bool | None = None

    model_config = ConfigDict(extra="forbid")


class IntegrationCredentialIn(BaseModel):
    name: str
    source_system: str
    workspace_id: str | None = None
    auth_type: str
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    secret_value: str | None = None
    is_enabled: bool = True


class IntegrationCredentialOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    name: str
    source_system: str
    auth_type: str
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    secret_mode: str = "none"
    has_secret: bool = False
    is_enabled: bool
    created_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime


class IntegrationConnectorOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    name: str
    endpoint_url: str
    source_system: str
    connector_type: str
    method: str
    auth_type: str
    auth_header_name: str | None = None
    username: str | None = None
    credential_id: str | None = None
    secret_ref: str | None = None
    secret_mode: str = "none"
    has_secret: bool = False
    static_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int
    is_enabled: bool
    created_by_user_id: str | None = None
    last_tested_at: datetime | None = None
    last_test_status: str | None = None
    last_test_message: str | None = None
    created_at: datetime
    updated_at: datetime


class IntegrationConnectorTestResponse(BaseModel):
    connector: IntegrationConnectorOut
    status_code: int
    ok: bool
    message: str
    response_preview: str = ""


class IntegrationDatabaseColumnSchemaOut(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    is_primary_key: bool = False


class IntegrationDatabaseTableSchemaOut(BaseModel):
    name: str
    schema_name: str | None = None
    full_name: str
    columns: list[IntegrationDatabaseColumnSchemaOut] = Field(default_factory=list)


class IntegrationConnectorDatabaseSchemaOut(BaseModel):
    connector: IntegrationConnectorOut
    dialect: str | None = None
    database: str | None = None
    tables: list[IntegrationDatabaseTableSchemaOut] = Field(default_factory=list)


class FlowBlockInputSchema(BaseModel):
    source_block_id: str
    edge_type: str = "data"
    case_value: str | None = None


class IntegrationFlowBlockIn(BaseModel):
    id: str
    block_type: str
    name: str | None = None
    input_block_id: str | None = None
    inputs: list[FlowBlockInputSchema] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class IntegrationFlowBlockOut(BaseModel):
    id: str
    block_type: str
    name: str | None = None
    input_block_id: str | None = None
    inputs: list[FlowBlockInputSchema] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class IntegrationFlowIn(BaseModel):
    name: str
    source_system: str = "erp"
    workspace_id: str | None = None
    is_enabled: bool = True
    blocks: list[IntegrationFlowBlockIn] = Field(default_factory=list)


class IntegrationFlowOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    name: str
    source_system: str
    is_enabled: bool
    blocks: list[IntegrationFlowBlockOut] = Field(default_factory=list)
    last_status: str | None = None
    last_message: str | None = None
    last_run_at: datetime | None = None
    created_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime


class IntegrationFlowReadinessIssueOut(BaseModel):
    code: str
    severity: str
    message: str
    block_id: str | None = None
    suggested_action: str | None = None


class IntegrationFlowReadinessBlockOut(BaseModel):
    block_id: str
    block_type: str
    status: str
    message: str
    issues: list[IntegrationFlowReadinessIssueOut] = Field(default_factory=list)


class IntegrationFlowReadinessSummaryOut(BaseModel):
    block_count: int = 0
    ready_block_count: int = 0
    attention_block_count: int = 0
    blocked_block_count: int = 0
    blocker_count: int = 0
    warning_count: int = 0


class IntegrationFlowReadinessOut(BaseModel):
    status: str
    message: str
    blocks: list[IntegrationFlowReadinessBlockOut] = Field(default_factory=list)
    blockers: list[IntegrationFlowReadinessIssueOut] = Field(default_factory=list)
    warnings: list[IntegrationFlowReadinessIssueOut] = Field(default_factory=list)
    summary: IntegrationFlowReadinessSummaryOut = Field(
        default_factory=IntegrationFlowReadinessSummaryOut
    )


class IntegrationFlowGraphIssueOut(BaseModel):
    code: str
    severity: str
    message: str
    block_ids: list[str] = Field(default_factory=list)


class IntegrationFlowValidateGraphOut(BaseModel):
    flow_id: str
    valid: bool
    issues: list[IntegrationFlowGraphIssueOut] = Field(default_factory=list)


class FlowTemplateBlockOut(BaseModel):
    id: str
    block_type: str
    name: str
    input_block_id: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class FlowTemplateOut(BaseModel):
    key: str
    title: str
    description: str
    outcome: str
    source_system: str
    blocks: list[FlowTemplateBlockOut] = Field(default_factory=list)


class IntegrationFlowRunBlockOut(BaseModel):
    block_id: str
    block_type: str
    status: str
    message: str
    input_preview: dict[str, Any] | None = None
    output_preview: dict[str, Any] | None = None
    output_summary: dict[str, Any] = Field(default_factory=dict)


class IntegrationFlowRunRequest(BaseModel):
    start_block_id: str | None = None
    stop_after_block_id: str | None = None


class IntegrationFlowRunScopeOut(BaseModel):
    mode: str = "full"
    flow_id: str | None = None
    requested_start_block_id: str | None = None
    requested_stop_after_block_id: str | None = None
    executed_block_ids: list[str] = Field(default_factory=list)
    final_block_id: str | None = None
    final_block_type: str | None = None
    # Studio v2 phase 3: synthesised by RunIntegrationFlow when the
    # FlowRunTraceRepository is wired so the UI can fetch /trace.
    run_id: str | None = None


class IntegrationFlowRunOut(BaseModel):
    flow: IntegrationFlowOut
    status: str
    message: str
    blocks: list[IntegrationFlowRunBlockOut] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    execution_scope: IntegrationFlowRunScopeOut = Field(
        default_factory=IntegrationFlowRunScopeOut
    )
    journal_entry: IntegrationJournalEntryOut | None = None


class FlowBlockConfigFieldOptionOut(BaseModel):
    """A single option for a select-style config field."""

    value: str
    label: str


class FlowBlockConfigFieldOut(BaseModel):
    """A UI form descriptor for a block's config key (Studio v2)."""

    key: str
    label: str
    field_type: str  # text | textarea | json | bool | number | connector | select
    required: bool = False
    help: str | None = None
    placeholder: str | None = None
    options: list[FlowBlockConfigFieldOptionOut] | None = None
    # Studio v2: when field_type=="connector", restricts the dropdown to
    # connectors with this connector_type (e.g. "sftp", "database").
    # Omit for blocks that accept any connector type.
    connector_type: str | None = None


class FlowTestBlockRequest(BaseModel):
    """Studio v2 phase 4 — body for POST /flows/{id}/test-block/{block_id}."""

    input: dict[str, Any] | None = None


class FlowTestBlockResponse(BaseModel):
    """Studio v2 phase 4 — single-block dry-run result, never persisted."""

    block_id: str
    block_type: str
    status: str
    message: str
    input_preview: dict[str, Any] | None = None
    output_preview: dict[str, Any] | None = None
    duration_ms: int = 0


class FlowRunTraceOut(BaseModel):
    """Studio v2 phase 3: one block's slice of a persisted flow run."""

    block_id: str
    block_type: str
    status: str
    duration_ms: int = 0
    error_message: str | None = None
    input_payload: dict[str, Any] = Field(default_factory=dict)
    output_payload: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime


class IntegrationFlowBlockCatalogItemOut(BaseModel):
    block_type: str
    label: str
    category: str
    description: str
    accepts_input: bool
    output_kind: str
    config_fields: list[FlowBlockConfigFieldOut] = Field(default_factory=list)
    expected_input_kinds: list[str] | None = None


class IntegrationAutomationJobIn(BaseModel):
    name: str
    direction: str = "inbound"
    trigger_type: str = "manual"
    source_system: str = "erp"
    workspace_id: str | None = None
    is_enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class IntegrationAutomationJobOut(BaseModel):
    id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    name: str
    direction: str
    trigger_type: str
    source_system: str
    is_enabled: bool
    config: dict[str, Any] = Field(default_factory=dict)
    last_status: str | None = None
    last_message: str | None = None
    last_run_at: datetime | None = None
    lock_owner: str | None = None
    locked_until: datetime | None = None
    attempt_count: int = 0
    next_attempt_at: datetime | None = None
    last_error_code: str | None = None
    last_error_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class IntegrationAutomationRunOut(BaseModel):
    job: IntegrationAutomationJobOut
    journal_entry: IntegrationJournalEntryOut
    message: str
    result: dict[str, Any] = Field(default_factory=dict)


class IntegrationAutomationRunDueRequest(BaseModel):
    workspace_id: str | None = None
    limit: int = Field(50, gt=0, le=200)
    dry_run: bool = False
    now: datetime | None = None


class IntegrationAutomationRunDueItemOut(BaseModel):
    job: IntegrationAutomationJobOut
    due: bool
    status: str
    message: str
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    result: dict[str, Any] = Field(default_factory=dict)


class IntegrationAutomationRunDueOut(BaseModel):
    checked_count: int
    due_count: int
    executed_count: int
    skipped_count: int
    failed_count: int
    locked_count: int
    retry_wait_count: int
    dry_run: bool
    results: list[IntegrationAutomationRunDueItemOut] = Field(default_factory=list)


class IntegrationAutomationHealthIssueOut(BaseModel):
    job: IntegrationAutomationJobOut
    status: str
    severity: str
    message: str
    next_action: str
    next_run_at: datetime | None = None


class IntegrationAutomationHealthOut(BaseModel):
    generated_at: datetime
    status: str
    summary: dict[str, int] = Field(default_factory=dict)
    issues: list[IntegrationAutomationHealthIssueOut] = Field(default_factory=list)
    jobs: list[IntegrationAutomationJobOut] = Field(default_factory=list)


class PublishedPlanOperationOut(BaseModel):
    operation_id: str
    work_order_id: str
    name: str | None = None
    sequence: int | None = None
    status: str | None = None
    external_ref: str | None = None
    eligible_machine_ids: list[str] = Field(default_factory=list)
    planned_machine_id: str | None = None
    planned_setup_start: datetime | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    previous_machine_id: str | None = None
    previous_setup_start: datetime | None = None
    previous_start: datetime | None = None
    previous_end: datetime | None = None
    change_type: str = "unchanged"
    changed_fields: list[str] = Field(default_factory=list)


class PublishedPlanWorkOrderOut(BaseModel):
    work_order_id: str
    name: str | None = None
    external_ref: str | None = None
    product_id: str | None = None
    quantity: int | None = None
    quantity_uom: str | None = None
    status: str | None = None
    order_type: str | None = None
    site_id: str | None = None
    item_id: str | None = None
    release_date: datetime | None = None
    due_date: datetime | None = None
    requested_date: datetime | None = None
    promised_date: datetime | None = None
    erp_status: str | None = None
    change_type: str = "unchanged"
    changed_fields: list[str] = Field(default_factory=list)
    scheduled_operation_count: int = 0
    changed_operation_count: int = 0
    operations: list[PublishedPlanOperationOut] = Field(default_factory=list)


class PublishedPlanExportRequest(BaseModel):
    source_system: str = "internal"
    schedule_id: str | None = None
    compare_to_schedule_id: str | None = None
    mode: str = "full"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PublishedPlanExportResponse(BaseModel):
    contract_version: str
    exported_at: datetime
    export_hash: str
    source_system: str
    mode: str
    organization_id: str | None = None
    workspace_id: str | None = None
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    compare_to_schedule_id: str | None = None
    input_snapshot_hash: str = ""
    engine_version: str = "aps-engine.v1"
    entity_counts: dict[str, int] = Field(default_factory=dict)
    change_counts: dict[str, int] = Field(default_factory=dict)
    work_orders: list[PublishedPlanWorkOrderOut] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExportPlanningSnapshotRequest(BaseModel):
    source_system: str = "internal"
    transfer_times: CanonicalTransferTimesSchema | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunScheduleFromSnapshotRequest(BaseModel):
    snapshot: CanonicalPlanningSnapshotSchema
    horizon_start: datetime | None = None
    horizon_days: int = Field(30, gt=0, le=365)
    heuristic: str = "edd"
    strategy: str = "greedy"
    objective: ObjectiveIn | None = None
