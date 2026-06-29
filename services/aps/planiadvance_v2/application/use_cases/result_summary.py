"""Helpers to build stable, planner-friendly result summaries.

The core strategies still own the raw solver diagnostics, but callers often
need a compact, stable read model that answers the first planner questions:

- How many operations were scheduled?
- Are we on time?
- Where is the bottleneck?
- What are the most actionable highlights?

These helpers intentionally keep the shape small and stable so the API, CLI,
tests and any future UI can rely on one summary contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ...domain.entities import Schedule, WorkOrder
from ...domain.scheduling.analysis import ScheduleAnalysis


@dataclass(slots=True)
class SchedulingSummary:
    scheduled_operation_count: int
    work_order_count: int
    makespan_minutes: int | None = None
    total_lateness_minutes: int | None = None
    on_time_ratio: float | None = None
    late_work_order_ids: list[str] = field(default_factory=list)
    bottleneck_machine_id: str | None = None
    bottleneck_utilization: float | None = None
    critical_path_minutes: int | None = None
    critical_path_operation_ids: list[str] = field(default_factory=list)
    highlights: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "scheduled_operation_count": self.scheduled_operation_count,
            "work_order_count": self.work_order_count,
            "makespan_minutes": self.makespan_minutes,
            "total_lateness_minutes": self.total_lateness_minutes,
            "on_time_ratio": self.on_time_ratio,
            "late_work_order_ids": list(self.late_work_order_ids),
            "bottleneck_machine_id": self.bottleneck_machine_id,
            "bottleneck_utilization": self.bottleneck_utilization,
            "critical_path_minutes": self.critical_path_minutes,
            "critical_path_operation_ids": list(self.critical_path_operation_ids),
            "highlights": list(self.highlights),
        }


def build_schedule_summary(
    *,
    schedule: Schedule | None,
    metrics: dict | None = None,
    analysis: ScheduleAnalysis | None = None,
    diagnostics: dict | None = None,
    work_orders: list[WorkOrder] | None = None,
    extra_highlights: list[str] | None = None,
) -> SchedulingSummary:
    metrics = metrics or {}
    diagnostics = diagnostics or {}
    work_orders = work_orders or []
    assignments = schedule.assignments if schedule is not None else []

    late_work_orders: list[str] = []
    bottleneck_machine_id: str | None = None
    bottleneck_utilization: float | None = None
    critical_path_minutes: int | None = None
    critical_path_ops: list[str] = []

    if analysis is not None:
        late_work_orders = [
            flow.work_order_id
            for flow in analysis.flow_times
            if flow.tardiness_minutes > 0
        ]
        bottleneck_machine_id = analysis.bottleneck.bottleneck_machine_id
        bottleneck_utilization = round(
            analysis.bottleneck.bottleneck_utilization, 4
        )
        critical_path_minutes = analysis.critical_path.total_minutes
        critical_path_ops = list(analysis.critical_path.operations)

    highlights = _build_highlights(
        metrics=metrics,
        analysis=analysis,
        diagnostics=diagnostics,
        late_work_orders=late_work_orders,
        extra_highlights=extra_highlights or [],
    )

    return SchedulingSummary(
        scheduled_operation_count=len(assignments),
        work_order_count=len(work_orders) or len({a.work_order_id for a in assignments}),
        makespan_minutes=_coerce_int(metrics.get("makespan_minutes")),
        total_lateness_minutes=_coerce_int(metrics.get("total_lateness_minutes")),
        on_time_ratio=_coerce_float(metrics.get("on_time_ratio")),
        late_work_order_ids=late_work_orders,
        bottleneck_machine_id=bottleneck_machine_id,
        bottleneck_utilization=bottleneck_utilization,
        critical_path_minutes=critical_path_minutes,
        critical_path_operation_ids=critical_path_ops,
        highlights=highlights,
    )


def _build_highlights(
    *,
    metrics: dict,
    analysis: ScheduleAnalysis | None,
    diagnostics: dict,
    late_work_orders: list[str],
    extra_highlights: list[str],
) -> list[str]:
    highlights: list[str] = []
    decision_trace = diagnostics.get("decision_trace")

    for item in extra_highlights:
        if item and item not in highlights:
            highlights.append(item)

    makespan = _coerce_int(metrics.get("makespan_minutes"))
    on_time_ratio = _coerce_float(metrics.get("on_time_ratio"))
    total_lateness = _coerce_int(metrics.get("total_lateness_minutes"))
    stability = metrics.get("stability")

    if makespan is not None:
        highlights.append(f"Makespan is {makespan} minutes.")

    if late_work_orders:
        sample = ", ".join(late_work_orders[:3])
        highlights.append(
            f"{len(late_work_orders)} work order(s) finish late ({sample})."
        )
    elif on_time_ratio == 1.0:
        highlights.append("All scheduled work orders finish on time.")

    if total_lateness:
        highlights.append(f"Total lateness is {total_lateness} minutes.")
    if isinstance(stability, dict):
        unchanged = stability.get("unchanged_operation_count")
        changed = stability.get("changed_operation_count")
        ratio = stability.get("stability_ratio")
        if isinstance(unchanged, int) and isinstance(changed, int):
            highlights.append(
                f"Plan stability kept {unchanged} operation(s) unchanged and moved {changed} versus baseline."
            )
        elif isinstance(ratio, (float, int)):
            highlights.append(
                f"Plan stability ratio is {round(float(ratio) * 100, 1)}% versus baseline."
            )

    if isinstance(decision_trace, list):
        max_transfer_delay = 0
        preempted_count = 0
        setup_impacted: list[tuple[str, int]] = []
        dependency_modes: list[str] = []

        for decision in decision_trace:
            if not isinstance(decision, dict):
                continue
            delay = decision.get("transfer_delay_minutes")
            if isinstance(delay, int) and delay > max_transfer_delay:
                max_transfer_delay = delay
            if decision.get("preempted") is True:
                preempted_count += 1
            op_id = decision.get("operation_id")
            setup_minutes = decision.get("setup_minutes")
            if (
                isinstance(op_id, str)
                and isinstance(setup_minutes, int)
                and setup_minutes > 0
            ):
                setup_impacted.append((op_id, setup_minutes))
            dependency_links = decision.get("dependency_links")
            if isinstance(dependency_links, list):
                for link in dependency_links:
                    if not isinstance(link, dict):
                        continue
                    if (
                        link.get("dependency_type") == "start_to_start"
                        and "start_to_start" not in dependency_modes
                    ):
                        dependency_modes.append("start_to_start")
                    lag_minutes = link.get("lag_minutes")
                    if (
                        isinstance(lag_minutes, int)
                        and lag_minutes < 0
                        and "overlap" not in dependency_modes
                    ):
                        dependency_modes.append("overlap")
                    if (
                        isinstance(link.get("max_wait_minutes"), int)
                        and "max_wait" not in dependency_modes
                    ):
                        dependency_modes.append("max_wait")

        if max_transfer_delay > 0:
            highlights.append(
                f"Transfer constraints added up to {max_transfer_delay} minutes before an operation could start."
            )
        if setup_impacted:
            op_id, minutes = max(setup_impacted, key=lambda item: item[1])
            highlights.append(
                f"{op_id} absorbed the largest setup burden at {minutes} minutes."
            )
        if preempted_count > 0:
            highlights.append(
                f"{preempted_count} operation(s) were split across multiple working windows."
            )
        if dependency_modes:
            highlights.append(
                "Advanced dependency rules active: "
                f"{', '.join(dependency_modes)}."
            )

    material_reservations = diagnostics.get("material_reservations")
    material_pegging_report = diagnostics.get("material_pegging_report")
    if (
        isinstance(material_pegging_report, dict)
        and material_pegging_report.get("available") is True
    ):
        material_count = material_pegging_report.get("material_count")
        uncovered_count = material_pegging_report.get("uncovered_reservation_count")
        if isinstance(uncovered_count, int) and uncovered_count > 0:
            highlights.append(
                f"Material pegging has {uncovered_count} uncovered reservation(s)."
            )
        elif isinstance(material_count, int) and material_count > 0:
            highlights.append(
                f"Material pegging fully covers {material_count} material(s)."
            )
    if isinstance(material_reservations, list) and material_reservations:
        material_ids = sorted(
            {
                reservation.get("material_id")
                for reservation in material_reservations
                if isinstance(reservation, dict)
                and isinstance(reservation.get("material_id"), str)
            }
        )
        if material_ids:
            highlights.append(
                f"Material reservations were generated for {len(material_ids)} material(s) ({', '.join(material_ids[:3])})."
            )
    delegated_strategy = diagnostics.get("delegated_strategy")
    delegation_reason = diagnostics.get("delegation_reason")
    reschedule_mode = diagnostics.get("reschedule_mode")
    policy_frozen_count = diagnostics.get("policy_frozen_count")
    stability_preference_applied = diagnostics.get("stability_preference_applied")
    policy_anchor = diagnostics.get("policy_anchor")
    if isinstance(reschedule_mode, str):
        if reschedule_mode == "repair_local":
            if isinstance(policy_frozen_count, int) and policy_frozen_count > 0:
                highlights.append(
                    f"Repair-local mode preserved {policy_frozen_count} unaffected future operation(s)."
                )
            else:
                highlights.append("Repair-local mode was used to limit schedule nervousness.")
        elif reschedule_mode == "net_change":
            if (
                isinstance(policy_frozen_count, int)
                and policy_frozen_count > 0
                and isinstance(policy_anchor, str)
            ):
                highlights.append(
                    f"Net-change mode preserved {policy_frozen_count} stable prefix operation(s) before {policy_anchor}."
                )
            elif stability_preference_applied is True:
                highlights.append(
                    "Net-change mode kept unaffected operations flexible but penalized unnecessary moves."
                )
            else:
                highlights.append(
                    "Net-change mode was used to preserve unaffected future operations."
                )
    stability_report = diagnostics.get("stability_report")
    if isinstance(stability_report, dict) and stability_report.get("available") is True:
        status = stability_report.get("status")
        changed_operation_count = stability_report.get("changed_operation_count")
        non_impacted_changed_count = stability_report.get("non_impacted_changed_count")
        frozen_changed_count = stability_report.get("frozen_changed_count")
        nervousness_score = stability_report.get("nervousness_score")
        if isinstance(frozen_changed_count, int) and frozen_changed_count > 0:
            highlights.append(
                f"Stability alert: {frozen_changed_count} frozen operation(s) changed versus baseline."
            )
        elif isinstance(non_impacted_changed_count, int) and non_impacted_changed_count > 0:
            highlights.append(
                f"Schedule nervousness: {non_impacted_changed_count} non-impacted operation(s) changed."
            )
        elif status == "stable":
            highlights.append("Stability report shows no unexpected operation movement.")
        if isinstance(changed_operation_count, int) and changed_operation_count > 0:
            highlights.append(
                f"Stability report explains {changed_operation_count} changed operation(s)."
            )
        if isinstance(nervousness_score, (float, int)) and nervousness_score > 0:
            highlights.append(
                f"Nervousness score is {round(float(nervousness_score), 2)}."
            )
    if isinstance(delegated_strategy, str) and isinstance(delegation_reason, str):
        highlights.append(
            f"Solver delegated to {delegated_strategy} for this run: {delegation_reason}"
        )

    if analysis is not None:
        util = analysis.bottleneck.bottleneck_utilization
        if analysis.bottleneck.bottleneck_machine_id:
            highlights.append(
                f"Bottleneck is {analysis.bottleneck.bottleneck_machine_id} at "
                f"{round(util * 100, 1)}% utilization."
            )
        if analysis.critical_path.operations:
            highlights.append(
                f"Critical path spans {analysis.critical_path.total_minutes} minutes "
                f"across {len(analysis.critical_path.operations)} operations."
            )

    if isinstance(decision_trace, list):
        for decision in decision_trace[:2]:
            if not isinstance(decision, dict):
                continue
            operation_id = decision.get("operation_id")
            machine_id = decision.get("machine_id")
            rejected = decision.get("rejected_candidates") or []
            if operation_id and machine_id and rejected:
                first = rejected[0]
                if isinstance(first, dict):
                    rejected_machine = first.get("machine_id")
                    rejected_kind = first.get("kind")
                    if rejected_machine and rejected_kind:
                        highlights.append(
                            f"{operation_id} ran on {machine_id} because "
                            f"{rejected_machine} was rejected for {rejected_kind}."
                        )
                        continue
            if operation_id and machine_id:
                highlights.append(
                    f"{operation_id} ran on {machine_id} at its earliest feasible slot."
                )

    # Keep the payload compact and deterministic.
    return highlights[:6]


def _coerce_int(value) -> int | None:
    return value if isinstance(value, int) else None


def _coerce_float(value) -> float | None:
    if isinstance(value, (float, int)):
        return round(float(value), 4)
    return None
