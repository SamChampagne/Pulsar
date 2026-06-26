"""Build planner-friendly diagnostics on top of raw solver traces.

The strategies already emit rich low-level diagnostics such as
``decision_trace`` or metaheuristic counters. This helper keeps those raw
details intact and adds a compact read model a planner can consume without
parsing solver internals.
"""

from __future__ import annotations

from collections import Counter

from .material_pegging_report import build_material_pegging_report

_CONSTRAINT_LABELS: dict[str, str] = {
    "resource_capacity": "Resource capacity",
    "material_shortage": "Material shortage",
    "machine_overloaded": "Machine overload",
    "calendar_too_tight": "Calendar window",
    "horizon_too_short": "Planning horizon",
    "dependency_window": "Dependency window",
    "dependency_max_wait": "Dependency max-wait",
    "custom_constraint": "Custom rule",
    "due_date_unreachable": "Due-date risk",
    "no_eligible_machine": "Machine eligibility",
    "dependency_not_ready": "Dependency readiness",
}

_CONSTRAINT_NAME_LABELS: dict[str, str] = {
    "dependency_window": "Dependency window",
    "dependency_max_wait": "Dependency max-wait",
    "start_to_start_sync": "Start-to-start synchronization",
    "start_to_start_max_wait": "Start-to-start max-wait",
    "finish_to_start_max_wait": "Finish-to-start max-wait",
    "finish_to_start_overlap": "Overlap / finish-to-start lag",
}


def _constraint_label(kind: str | None) -> str:
    if not kind:
        return "Unknown constraint"
    return _CONSTRAINT_LABELS.get(
        kind,
        kind.replace("_", " ").capitalize(),
    )


def _constraint_detail_label(
    kind: str | None,
    constraint_name: str | None,
) -> str:
    if constraint_name:
        return _CONSTRAINT_NAME_LABELS.get(
            constraint_name,
            constraint_name.replace("_", " ").capitalize(),
        )
    return _constraint_label(kind)


def _reason_text(
    *,
    operation_id: str,
    selected_machine_id: str,
    rejected_machine_id: str | None,
    reason_kind: str | None,
    constraint_name: str | None,
) -> str:
    reason_label = _constraint_detail_label(reason_kind, constraint_name).lower()
    if rejected_machine_id and reason_kind:
        return (
            f"{operation_id} ran on {selected_machine_id} because "
            f"{rejected_machine_id} was blocked by {reason_label}."
        )
    return f"{operation_id} ran on {selected_machine_id} at the first feasible slot."


def enrich_planner_diagnostics(
    diagnostics: dict | None,
    *,
    metrics: dict | None = None,
    strategy: str | None = None,
) -> dict:
    enriched = dict(diagnostics or {})
    existing = enriched.get("planner_diagnostics")
    if isinstance(existing, dict):
        return enriched

    planner: dict[str, object] = {}
    notes: list[str] = []
    metrics = metrics or {}

    if strategy:
        planner["strategy"] = strategy
    planner["language_version"] = "planner-v1"

    decision_trace = enriched.get("decision_trace")
    material_reservations = enriched.get("material_reservations")
    if isinstance(decision_trace, list):
        machine_counts: Counter[str] = Counter()
        rejection_counts: Counter[str] = Counter()
        rejection_examples: dict[str, dict[str, str | None]] = {}
        key_decisions: list[dict[str, str | int | None]] = []
        decision_cards: list[dict[str, object]] = []
        delay_drivers: list[dict[str, str | int]] = []
        late_operations: list[str] = []
        preempted_operations: list[str] = []

        for decision in decision_trace:
            if not isinstance(decision, dict):
                continue
            operation_id = decision.get("operation_id")
            machine_id = decision.get("machine_id")
            if isinstance(machine_id, str):
                machine_counts[machine_id] += 1
            if isinstance(operation_id, str) and decision.get("late_against_due_date") is True:
                late_operations.append(operation_id)
            if isinstance(operation_id, str) and decision.get("preempted") is True:
                preempted_operations.append(operation_id)

            transfer_delay = decision.get("transfer_delay_minutes")
            if isinstance(operation_id, str) and isinstance(transfer_delay, int) and transfer_delay > 0:
                delay_drivers.append(
                    {
                        "operation_id": operation_id,
                        "type": "transfer",
                        "minutes": transfer_delay,
                    }
                )

            setup_minutes = decision.get("setup_minutes")
            if isinstance(operation_id, str) and isinstance(setup_minutes, int) and setup_minutes > 0:
                delay_drivers.append(
                    {
                        "operation_id": operation_id,
                        "type": "setup",
                        "minutes": setup_minutes,
                    }
                )

            rejected_candidates = decision.get("rejected_candidates")
            if not isinstance(rejected_candidates, list):
                continue
            valid_rejections = [r for r in rejected_candidates if isinstance(r, dict)]
            if not valid_rejections:
                continue

            for rejected in valid_rejections:
                kind = rejected.get("kind")
                if isinstance(kind, str):
                    rejection_counts[kind] += 1
                    rejection_examples.setdefault(kind, rejected)

            first = valid_rejections[0]
            rejected_machine_id = first.get("machine_id")
            rejected_kind = first.get("kind")
            rejected_constraint_name = first.get("constraint_name")
            dominant_constraint = (
                rejected_kind if isinstance(rejected_kind, str) else None
            )
            reason_text = _reason_text(
                operation_id=operation_id,
                selected_machine_id=machine_id,
                rejected_machine_id=(
                    rejected_machine_id if isinstance(rejected_machine_id, str) else None
                ),
                reason_kind=dominant_constraint,
                constraint_name=(
                    rejected_constraint_name
                    if isinstance(rejected_constraint_name, str)
                    else None
                ),
            )
            selected_reason_code = (
                rejected_constraint_name
                if isinstance(rejected_constraint_name, str)
                else dominant_constraint
            )
            selected_reason_label = _constraint_detail_label(
                dominant_constraint,
                selected_reason_code if isinstance(selected_reason_code, str) else None,
            )
            decision_cards.append(
                {
                    "operation_id": operation_id,
                    "selected_machine_id": machine_id,
                    "dominant_constraint_kind": dominant_constraint,
                    "dominant_constraint_label": selected_reason_label,
                    "selected_reason_code": (
                        selected_reason_code
                        if selected_reason_code
                        else "earliest_feasible_slot"
                    ),
                    "selected_reason_label": selected_reason_label,
                    "selected_reason_text": reason_text,
                    "late_against_due_date": decision.get("late_against_due_date") is True,
                    "transfer_delay_minutes": (
                        decision.get("transfer_delay_minutes")
                        if isinstance(decision.get("transfer_delay_minutes"), int)
                        else 0
                    ),
                    "setup_minutes": (
                        decision.get("setup_minutes")
                        if isinstance(decision.get("setup_minutes"), int)
                        else 0
                    ),
                }
            )
            if (
                isinstance(operation_id, str)
                and isinstance(machine_id, str)
            ):
                key_decisions.append(
                    {
                        "operation_id": operation_id,
                        "selected_machine_id": machine_id,
                        "rejected_machine_id": (
                            rejected_machine_id
                            if isinstance(rejected_machine_id, str)
                            else None
                        ),
                        "reason_kind": dominant_constraint,
                        "reason_label": selected_reason_label,
                        "reason_code": selected_reason_code,
                        "reason": reason_text,
                    }
                )
            continue

            if isinstance(operation_id, str) and isinstance(machine_id, str):
                decision_cards.append(
                    {
                        "operation_id": operation_id,
                        "selected_machine_id": machine_id,
                        "dominant_constraint_kind": None,
                        "dominant_constraint_label": "Earliest feasible slot",
                        "selected_reason_code": "earliest_feasible_slot",
                        "selected_reason_label": "Earliest feasible slot",
                        "selected_reason_text": _reason_text(
                            operation_id=operation_id,
                            selected_machine_id=machine_id,
                            rejected_machine_id=None,
                            reason_kind=None,
                            constraint_name=None,
                        ),
                        "late_against_due_date": decision.get("late_against_due_date") is True,
                        "transfer_delay_minutes": (
                            decision.get("transfer_delay_minutes")
                            if isinstance(decision.get("transfer_delay_minutes"), int)
                            else 0
                        ),
                        "setup_minutes": (
                            decision.get("setup_minutes")
                            if isinstance(decision.get("setup_minutes"), int)
                            else 0
                        ),
                    }
                )

        # Add fallback cards for decisions that had no rejected candidates.
        recorded = {
            str(card["operation_id"])
            for card in decision_cards
            if isinstance(card, dict) and isinstance(card.get("operation_id"), str)
        }
        for decision in decision_trace:
            if not isinstance(decision, dict):
                continue
            operation_id = decision.get("operation_id")
            machine_id = decision.get("machine_id")
            if (
                not isinstance(operation_id, str)
                or operation_id in recorded
                or not isinstance(machine_id, str)
            ):
                continue
            decision_cards.append(
                {
                    "operation_id": operation_id,
                    "selected_machine_id": machine_id,
                    "dominant_constraint_kind": None,
                    "dominant_constraint_label": "Earliest feasible slot",
                    "selected_reason_code": "earliest_feasible_slot",
                    "selected_reason_label": "Earliest feasible slot",
                    "selected_reason_text": _reason_text(
                        operation_id=operation_id,
                        selected_machine_id=machine_id,
                        rejected_machine_id=None,
                        reason_kind=None,
                        constraint_name=None,
                    ),
                    "late_against_due_date": decision.get("late_against_due_date") is True,
                    "transfer_delay_minutes": (
                        decision.get("transfer_delay_minutes")
                        if isinstance(decision.get("transfer_delay_minutes"), int)
                        else 0
                    ),
                    "setup_minutes": (
                        decision.get("setup_minutes")
                        if isinstance(decision.get("setup_minutes"), int)
                        else 0
                    ),
                }
            )

        busiest_machines = [
            {"machine_id": machine_id, "operation_count": count}
            for machine_id, count in machine_counts.most_common(3)
        ]
        top_constraints = [
            {
                "kind": kind,
                "label": _constraint_label(kind),
                "count": count,
                "sample_machine_id": rejection_examples.get(kind, {}).get("machine_id"),
                "sample_message": rejection_examples.get(kind, {}).get("message"),
            }
            for kind, count in rejection_counts.most_common(3)
        ]
        top_delay_drivers = sorted(
            delay_drivers,
            key=lambda item: (int(item["minutes"]), str(item["operation_id"])),
            reverse=True,
        )[:5]
        dependency_modes: list[str] = []
        for decision in decision_trace:
            if not isinstance(decision, dict):
                continue
            dependency_links = decision.get("dependency_links")
            if not isinstance(dependency_links, list):
                continue
            for link in dependency_links:
                if not isinstance(link, dict):
                    continue
                dep_type = link.get("dependency_type")
                lag_minutes = link.get("lag_minutes")
                max_wait = link.get("max_wait_minutes")
                if dep_type == "start_to_start" and "start_to_start" not in dependency_modes:
                    dependency_modes.append("start_to_start")
                if (
                    isinstance(lag_minutes, int)
                    and lag_minutes < 0
                    and "overlap" not in dependency_modes
                ):
                    dependency_modes.append("overlap")
                if isinstance(max_wait, int) and "max_wait" not in dependency_modes:
                    dependency_modes.append("max_wait")

        if busiest_machines:
            busiest = busiest_machines[0]
            notes.append(
                f"{busiest['machine_id']} handled the most operations in this plan ({busiest['operation_count']})."
            )
        if dependency_modes:
            notes.append(
                "Advanced dependency modes active: "
                f"{', '.join(dependency_modes)}."
            )
        if top_constraints:
            top = top_constraints[0]
            notes.append(
                f"Constraint pressure was led by {top['label'].lower()} on {top['count']} candidate machine(s)."
            )
        if top_delay_drivers:
            top = top_delay_drivers[0]
            notes.append(
                f"Largest {top['type']} delay was on {top['operation_id']} at {top['minutes']} minutes."
            )
        if late_operations:
            notes.append(
                f"{len(late_operations)} operation(s) finished after the due-date target."
            )
        if preempted_operations:
            notes.append(
                f"{len(preempted_operations)} operation(s) had to be split across working windows."
            )

        planner.update(
            {
                "decision_count": len([d for d in decision_trace if isinstance(d, dict)]),
                "busiest_machines": busiest_machines,
                "top_constraints": top_constraints,
                "key_decisions": key_decisions[:5],
                "decision_cards": decision_cards[:8],
                "top_delay_drivers": top_delay_drivers,
                "late_operations": late_operations[:5],
                "preempted_operations": preempted_operations[:5],
                "dependency_modes": dependency_modes,
            }
        )

    if isinstance(material_reservations, list):
        material_pegging_report = build_material_pegging_report(
            [item for item in material_reservations if isinstance(item, dict)]
        )
        enriched["material_pegging_report"] = material_pegging_report
        planner["material_pegging_report"] = material_pegging_report
        by_material: Counter[str] = Counter()
        by_operation: list[dict[str, object]] = []
        for reservation in material_reservations:
            if not isinstance(reservation, dict):
                continue
            material_id = reservation.get("material_id")
            quantity = reservation.get("quantity")
            operation_id = reservation.get("operation_id")
            if isinstance(material_id, str):
                by_material[material_id] += 1
            if isinstance(material_id, str) and isinstance(operation_id, str):
                by_operation.append(
                    {
                        "operation_id": operation_id,
                        "material_id": material_id,
                        "quantity": quantity,
                        "required_at": reservation.get("required_at"),
                        "allocations": (
                            list(reservation.get("allocations", []))
                            if isinstance(reservation.get("allocations"), list)
                            else []
                        ),
                        "uncovered_quantity": reservation.get("uncovered_quantity", 0.0),
                    }
                )
        if by_material:
            planner["material_reservation_count"] = len(
                [item for item in material_reservations if isinstance(item, dict)]
            )
            planner["material_pressure"] = [
                {"material_id": material_id, "reservation_count": count}
                for material_id, count in by_material.most_common(5)
            ]
            planner["material_pegging_preview"] = by_operation[:8]
            top_material, top_count = by_material.most_common(1)[0]
            notes.append(
                f"Material {top_material} was reserved {top_count} time(s) in this plan."
            )
            first_pegging = by_operation[0]
            allocations = first_pegging.get("allocations")
            if isinstance(allocations, list) and allocations:
                source_ids = [
                    allocation.get("source_id")
                    for allocation in allocations
                    if isinstance(allocation, dict)
                    and isinstance(allocation.get("source_id"), str)
                ]
                if source_ids:
                    notes.append(
                        f"Material pegging traces back to {', '.join(source_ids[:3])}."
                    )
            if material_pegging_report.get("status") == "short":
                blocked = material_pegging_report.get("blocked_operations")
                blocked_count = len(blocked) if isinstance(blocked, list) else 0
                notes.append(
                    f"Material pegging found {blocked_count} uncovered reservation(s)."
                )

    accepted_moves = enriched.get("accepted_moves")
    rejected_moves = enriched.get("rejected_moves")
    evaluations = enriched.get("evaluations")
    if isinstance(accepted_moves, int) and isinstance(rejected_moves, int):
        notes.append(
            f"Search accepted {accepted_moves} move(s) and rejected {rejected_moves}."
        )
    if isinstance(evaluations, int):
        notes.append(f"Search evaluated {evaluations} candidate schedule(s).")

    winner = enriched.get("winner_label")
    if isinstance(winner, str):
        notes.append(f"Winning run variant was {winner}.")

    if enriched.get("used_warm_start") is True:
        notes.append("Solver reused a warm start from a previous schedule.")
    delegation_reason = enriched.get("delegation_reason")
    delegated_strategy = enriched.get("delegated_strategy")
    if isinstance(delegated_strategy, str) and isinstance(delegation_reason, str):
        notes.append(
            f"{strategy or 'Solver'} delegated to {delegated_strategy}: {delegation_reason}"
        )

    total_lateness = metrics.get("total_lateness_minutes")
    if isinstance(total_lateness, int) and total_lateness > 0:
        notes.append(f"Plan still carries {total_lateness} minutes of lateness.")

    deduped_notes: list[str] = []
    for note in notes:
        if note and note not in deduped_notes:
            deduped_notes.append(note)

    planner["notes"] = deduped_notes[:6]
    planner_exceptions = enriched.get("planner_exceptions")
    if isinstance(planner_exceptions, dict):
        planner["exceptions"] = planner_exceptions
    enriched["planner_diagnostics"] = planner
    return enriched
