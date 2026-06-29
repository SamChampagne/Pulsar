"""Use case: compare persisted schedule scenarios.

The project already persists schedule runs with scenario metadata. This module
turns those runs into a scenario-management read model without duplicating the
schedule repository or inventing a second persistence path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ...domain.entities import Schedule
from ...domain.errors import ValidationError
from ..ports import ScheduleRepository, ScheduleRunMetadata
from .planning_validation_gate import validate_schedule_scope
from .stability_report import build_stability_report


@dataclass(frozen=True, slots=True)
class ScenarioRunCard:
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    workspace_id: str
    organization_id: str | None
    horizon_start: datetime | None
    horizon_end: datetime | None
    input_snapshot_hash: str
    engine_version: str
    strategy: str
    solver_status: str
    objective_value: int
    metrics: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "scenario_name": self.scenario_name,
            "lifecycle_status": self.lifecycle_status,
            "workspace_id": self.workspace_id,
            "organization_id": self.organization_id,
            "horizon_start": self.horizon_start,
            "horizon_end": self.horizon_end,
            "input_snapshot_hash": self.input_snapshot_hash,
            "engine_version": self.engine_version,
            "strategy": self.strategy,
            "solver_status": self.solver_status,
            "objective_value": self.objective_value,
            "metrics": dict(self.metrics),
            "diagnostics": dict(self.diagnostics),
        }


@dataclass(frozen=True, slots=True)
class ScenarioComparisonCard:
    candidate: ScenarioRunCard
    metric_delta: dict[str, object]
    stability_report: dict[str, object]
    publish_status: str
    recommendation: str
    score: tuple[int, int, int, int, str]

    def as_dict(self) -> dict[str, object]:
        return {
            "candidate": self.candidate.as_dict(),
            "metric_delta": dict(self.metric_delta),
            "stability_report": dict(self.stability_report),
            "publish_status": self.publish_status,
            "recommendation": self.recommendation,
            "score": list(self.score),
        }


@dataclass(frozen=True, slots=True)
class CompareScenariosInput:
    baseline_schedule_id: str
    candidate_schedule_ids: list[str]
    organization_id: str | None = None
    max_operation_changes: int = 25


@dataclass(frozen=True, slots=True)
class CompareScenariosOutput:
    baseline: ScenarioRunCard
    comparisons: list[ScenarioComparisonCard]
    recommended_schedule_id: str | None
    publishable_schedule_ids: list[str]
    summary: dict[str, object]

    def as_dict(self) -> dict[str, object]:
        return {
            "baseline": self.baseline.as_dict(),
            "comparisons": [comparison.as_dict() for comparison in self.comparisons],
            "recommended_schedule_id": self.recommended_schedule_id,
            "publishable_schedule_ids": list(self.publishable_schedule_ids),
            "summary": dict(self.summary),
        }


class CompareScenarios:
    """Compare candidate scenario runs against a baseline run."""

    def __init__(self, repository: ScheduleRepository) -> None:
        self._repository = repository

    def execute(self, command: CompareScenariosInput) -> CompareScenariosOutput:
        if not command.candidate_schedule_ids:
            raise ValidationError("At least one candidate schedule is required")

        baseline, baseline_meta = self._load_scoped(
            command.baseline_schedule_id,
            expected_organization_id=command.organization_id,
            label="Baseline",
        )
        baseline_card = _run_card(baseline, baseline_meta)
        comparisons = [
            self._compare_one(
                baseline=baseline,
                baseline_meta=baseline_meta,
                candidate_id=candidate_id,
                organization_id=command.organization_id,
                max_operation_changes=command.max_operation_changes,
            )
            for candidate_id in _dedupe(command.candidate_schedule_ids)
            if candidate_id != command.baseline_schedule_id
        ]
        if not comparisons:
            raise ValidationError("At least one candidate must differ from baseline")

        recommendable = [
            comparison
            for comparison in comparisons
            if comparison.publish_status != "blocked"
        ]
        recommended = (
            min(recommendable, key=lambda item: item.score)
            if recommendable
            else None
        )
        publishable = [
            comparison.candidate.schedule_id
            for comparison in comparisons
            if comparison.publish_status == "publishable"
        ]
        return CompareScenariosOutput(
            baseline=baseline_card,
            comparisons=comparisons,
            recommended_schedule_id=(
                recommended.candidate.schedule_id if recommended is not None else None
            ),
            publishable_schedule_ids=publishable,
            summary={
                "comparison_count": len(comparisons),
                "recommended_schedule_id": (
                    recommended.candidate.schedule_id
                    if recommended is not None
                    else None
                ),
                "recommended_scenario_name": (
                    recommended.candidate.scenario_name
                    if recommended is not None
                    else None
                ),
                "publishable_count": len(publishable),
                "has_publishable_candidate": bool(publishable),
            },
        )

    def _compare_one(
        self,
        *,
        baseline: Schedule,
        baseline_meta: ScheduleRunMetadata,
        candidate_id: str,
        organization_id: str | None,
        max_operation_changes: int,
    ) -> ScenarioComparisonCard:
        candidate, candidate_meta = self._load_scoped(
            candidate_id,
            expected_organization_id=organization_id,
            label="Candidate",
        )
        stability = build_stability_report(
            schedule=candidate,
            baseline_schedule=baseline,
            max_operations=max_operation_changes,
        )
        delta = _metric_delta(baseline_meta.metrics, candidate_meta.metrics)
        delta["objective_value"] = (
            candidate_meta.objective_value - baseline_meta.objective_value
        )
        publish_status, recommendation = _publish_assessment(
            metadata=candidate_meta,
            metric_delta=delta,
            stability_report=stability,
        )
        card = _run_card(candidate, candidate_meta)
        return ScenarioComparisonCard(
            candidate=card,
            metric_delta=delta,
            stability_report=stability,
            publish_status=publish_status,
            recommendation=recommendation,
            score=_score_candidate(
                metadata=candidate_meta,
                metric_delta=delta,
                stability_report=stability,
                publish_status=publish_status,
            ),
        )

    def _load_scoped(
        self,
        schedule_id: str,
        *,
        expected_organization_id: str | None,
        label: str,
    ) -> tuple[Schedule, ScheduleRunMetadata]:
        schedule = self._repository.get(schedule_id)
        metadata = self._repository.get_metadata(schedule_id)
        if schedule is None or metadata is None:
            raise ValidationError(f"{label} schedule {schedule_id!r} not found")
        validate_schedule_scope(
            metadata,
            expected_organization_id=expected_organization_id,
            schedule_id=schedule_id,
            label=label,
        )
        return schedule, metadata


def _run_card(schedule: Schedule, metadata: ScheduleRunMetadata) -> ScenarioRunCard:
    return ScenarioRunCard(
        schedule_id=schedule.id,
        scenario_name=metadata.scenario_name,
        lifecycle_status=metadata.lifecycle_status,
        workspace_id=metadata.workspace_id,
        organization_id=metadata.organization_id,
        horizon_start=metadata.horizon_start,
        horizon_end=metadata.horizon_end,
        input_snapshot_hash=metadata.input_snapshot_hash,
        engine_version=metadata.engine_version,
        strategy=metadata.strategy,
        solver_status=metadata.solver_status,
        objective_value=metadata.objective_value,
        metrics=metadata.metrics,
        diagnostics=metadata.diagnostics,
    )


def _metric_delta(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, object]:
    return {
        "makespan_minutes": _delta(candidate, baseline, "makespan_minutes"),
        "total_lateness_minutes": _delta(candidate, baseline, "total_lateness_minutes"),
        "on_time_ratio": _delta(candidate, baseline, "on_time_ratio"),
    }


def _delta(candidate: dict[str, Any], baseline: dict[str, Any], key: str) -> object:
    left = candidate.get(key)
    right = baseline.get(key)
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return round(left - right, 4)
    return None


def _publish_assessment(
    *,
    metadata: ScheduleRunMetadata,
    metric_delta: dict[str, object],
    stability_report: dict[str, object],
) -> tuple[str, str]:
    if metadata.solver_status != "feasible":
        return "blocked", "Do not publish an infeasible or failed scenario."
    planner_exceptions = metadata.diagnostics.get("planner_exceptions")
    if isinstance(planner_exceptions, dict) and planner_exceptions.get("status") == "blocked":
        return "blocked", "Resolve planner exceptions before publishing."
    if stability_report.get("status") == "frozen_changed":
        return "blocked", "Frozen operations changed versus baseline."
    lateness_delta = metric_delta.get("total_lateness_minutes")
    if isinstance(lateness_delta, (int, float)) and lateness_delta > 0:
        return "review", "Review lateness increase before publishing."
    if stability_report.get("status") == "nervous":
        return "review", "Review schedule nervousness before publishing."
    return "publishable", "Candidate can be promoted if business assumptions are accepted."


def _score_candidate(
    *,
    metadata: ScheduleRunMetadata,
    metric_delta: dict[str, object],
    stability_report: dict[str, object],
    publish_status: str,
) -> tuple[int, int, int, int, str]:
    status_rank = {"publishable": 0, "review": 1, "blocked": 2}.get(
        publish_status,
        3,
    )
    lateness_delta = metric_delta.get("total_lateness_minutes")
    makespan_delta = metric_delta.get("makespan_minutes")
    nervousness = stability_report.get("nervousness_score")
    return (
        status_rank,
        int(lateness_delta) if isinstance(lateness_delta, (int, float)) else 0,
        int(nervousness) if isinstance(nervousness, (int, float)) else 0,
        int(makespan_delta) if isinstance(makespan_delta, (int, float)) else 0,
        metadata.scenario_name,
    )


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped
