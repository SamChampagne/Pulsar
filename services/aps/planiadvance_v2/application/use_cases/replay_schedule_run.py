"""Use case: replay a persisted scheduling run from its input snapshot."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from math import ceil

from ...application.integration import (
    planning_snapshot_from_json,
    planning_snapshot_hash,
)
from ...domain.entities import Schedule
from ...domain.errors import ValidationError
from ...domain.scheduling import Objective
from ..ports import ScheduleRepository
from .run_scheduling import RunSchedulingOutput
from .run_scheduling_from_snapshot import (
    RunSchedulingFromSnapshot,
    RunSchedulingFromSnapshotInput,
)


@dataclass(slots=True)
class ReplayScheduleRunInput:
    schedule_id: str
    strategy: str | None = None


@dataclass(slots=True)
class ReplayScheduleRunOutput:
    original_schedule_id: str
    input_snapshot_hash: str
    replay_matches_original: bool
    hash_matches: bool
    strategy_matches: bool
    objective_matches: bool
    assignment_delta: dict[str, object]
    metrics_delta: dict[str, object]
    divergence_reasons: list[str]
    replay_report: dict[str, object]
    replay: RunSchedulingOutput


class ReplayScheduleRun:
    """Re-run a persisted schedule from the exact captured planning snapshot."""

    def __init__(self, schedules: ScheduleRepository) -> None:
        self._schedules = schedules
        self._runner = RunSchedulingFromSnapshot()

    def execute(self, command: ReplayScheduleRunInput) -> ReplayScheduleRunOutput:
        original = self._schedules.get(command.schedule_id)
        metadata = self._schedules.get_metadata(command.schedule_id)
        if original is None or metadata is None:
            raise ValidationError(f"Schedule {command.schedule_id!r} not found")
        if not metadata.input_snapshot:
            raise ValidationError(
                f"Schedule {command.schedule_id!r} has no persisted input snapshot"
            )
        if metadata.horizon_start is None or metadata.horizon_end is None:
            raise ValidationError(
                f"Schedule {command.schedule_id!r} has no persisted horizon"
            )

        computed_hash = planning_snapshot_hash(metadata.input_snapshot)
        if metadata.input_snapshot_hash and computed_hash != metadata.input_snapshot_hash:
            raise ValidationError(
                "Persisted input snapshot hash does not match its JSON payload"
            )
        hash_matches = (
            not metadata.input_snapshot_hash
            or computed_hash == metadata.input_snapshot_hash
        )
        replay_strategy = command.strategy or metadata.strategy

        horizon_days = max(
            1,
            ceil((metadata.horizon_end - metadata.horizon_start) / timedelta(days=1)),
        )
        replay = self._runner.execute(
            RunSchedulingFromSnapshotInput(
                snapshot=planning_snapshot_from_json(metadata.input_snapshot),
                horizon_start=metadata.horizon_start,
                horizon_days=horizon_days,
                strategy=replay_strategy,
                objective=_objective_from_json(metadata.objective),
            )
        )
        replay.organization_id = metadata.organization_id
        replay.horizon_start = metadata.horizon_start
        replay.horizon_end = metadata.horizon_end
        replay.objective = dict(metadata.objective)
        replay.transfer_times = dict(metadata.transfer_times)
        replay.input_snapshot_hash = computed_hash
        replay.engine_version = metadata.engine_version
        delta = _assignment_delta(original, replay.schedule)
        metrics_delta = _metrics_delta(metadata.metrics, replay.metrics)
        strategy_matches = replay.strategy == metadata.strategy
        objective_matches = _objective_from_json(metadata.objective) == _objective_from_json(
            replay.objective
        )
        metrics_match = not any(
            item.get("changed") is True for item in metrics_delta.values()
        )
        divergence_reasons = _divergence_reasons(
            hash_matches=hash_matches,
            strategy_matches=strategy_matches,
            strategy_overridden=(
                command.strategy is not None and command.strategy != metadata.strategy
            ),
            objective_matches=objective_matches,
            assignment_delta=delta,
            metrics_match=metrics_match,
        )
        replay_matches_original = (
            hash_matches
            and strategy_matches
            and objective_matches
            and delta["changed_count"] == 0
            and metrics_match
        )
        replay_report = {
            "status": "matched" if replay_matches_original else "diverged",
            "original_strategy": metadata.strategy,
            "replay_strategy": replay.strategy,
            "original_operation_count": delta["original_operation_count"],
            "replay_operation_count": delta["replay_operation_count"],
            "changed_operation_count": delta["changed_count"],
            "changed_metric_count": sum(
                1 for item in metrics_delta.values() if item.get("changed") is True
            ),
            "divergence_reasons": list(divergence_reasons),
        }
        return ReplayScheduleRunOutput(
            original_schedule_id=command.schedule_id,
            input_snapshot_hash=computed_hash,
            replay_matches_original=replay_matches_original,
            hash_matches=hash_matches,
            strategy_matches=strategy_matches,
            objective_matches=objective_matches,
            assignment_delta=delta,
            metrics_delta=metrics_delta,
            divergence_reasons=divergence_reasons,
            replay_report=replay_report,
            replay=replay,
        )


def _objective_from_json(data: dict) -> Objective:
    if not data:
        return Objective.default()
    return Objective(
        makespan=int(data.get("makespan", 1)),
        total_tardiness=int(data.get("total_tardiness", 10)),
        weighted_tardiness=int(data.get("weighted_tardiness", 0)),
        setup_cost=int(data.get("setup_cost", 0)),
        idle_penalty=int(data.get("idle_penalty", 0)),
        start_shift_penalty=int(data.get("start_shift_penalty", 0)),
        machine_change_penalty=int(data.get("machine_change_penalty", 0)),
    )


def _assignment_key(schedule: Schedule) -> dict[str, tuple[str, str, str, str, str]]:
    return {
        assignment.operation_id: (
            assignment.work_order_id,
            assignment.machine_id,
            assignment.setup_start.isoformat(),
            assignment.start.isoformat(),
            assignment.end.isoformat(),
        )
        for assignment in schedule.assignments
    }


def _assignment_delta(original: Schedule, replayed: Schedule) -> dict[str, object]:
    original_by_op = _assignment_key(original)
    replayed_by_op = _assignment_key(replayed)
    all_operation_ids = sorted(set(original_by_op) | set(replayed_by_op))
    changed = [
        operation_id
        for operation_id in all_operation_ids
        if original_by_op.get(operation_id) != replayed_by_op.get(operation_id)
    ]
    return {
        "changed_count": len(changed),
        "changed_operation_ids": changed[:25],
        "original_operation_count": len(original_by_op),
        "replay_operation_count": len(replayed_by_op),
    }


def _metrics_delta(original: dict, replayed: dict) -> dict[str, dict[str, object]]:
    keys = sorted(set(original) | set(replayed))
    deltas: dict[str, dict[str, object]] = {}
    for key in keys:
        before = original.get(key)
        after = replayed.get(key)
        if isinstance(before, bool) or isinstance(after, bool):
            changed = before != after
            delta = None
        elif isinstance(before, (int, float)) and isinstance(after, (int, float)):
            delta = after - before
            changed = abs(float(delta)) > 0.000001
        else:
            delta = None
            changed = before != after
        if changed:
            deltas[key] = {
                "original": before,
                "replay": after,
                "delta": delta,
                "changed": True,
            }
    return deltas


def _divergence_reasons(
    *,
    hash_matches: bool,
    strategy_matches: bool,
    strategy_overridden: bool,
    objective_matches: bool,
    assignment_delta: dict[str, object],
    metrics_match: bool,
) -> list[str]:
    reasons: list[str] = []
    if not hash_matches:
        reasons.append("input_snapshot_hash_mismatch")
    if strategy_overridden:
        reasons.append("strategy_override")
    elif not strategy_matches:
        reasons.append("strategy_mismatch")
    if not objective_matches:
        reasons.append("objective_mismatch")
    if assignment_delta["original_operation_count"] != assignment_delta["replay_operation_count"]:
        reasons.append("operation_count_changed")
    if assignment_delta["changed_count"] != 0:
        reasons.append("assignments_changed")
    if not metrics_match:
        reasons.append("metrics_changed")
    return reasons
