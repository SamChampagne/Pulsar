"""Use case: publish a persisted schedule scenario."""

from __future__ import annotations

from dataclasses import dataclass, field

from ...domain.errors import ValidationError
from ..ports import ScheduleRepository, ScheduleRunMetadata
from .compare_scenarios import (
    CompareScenarios,
    CompareScenariosInput,
    ScenarioComparisonCard,
)
from .planning_validation_gate import validate_schedule_scope


@dataclass(frozen=True, slots=True)
class PublishScenarioInput:
    schedule_id: str
    baseline_schedule_id: str | None = None
    scenario_name: str | None = None
    organization_id: str | None = None
    allow_review: bool = False


@dataclass(frozen=True, slots=True)
class PublishScenarioOutput:
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    publish_status: str
    recommendation: str
    comparison: dict[str, object] | None = None
    metadata: ScheduleRunMetadata = field(default_factory=ScheduleRunMetadata)

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "scenario_name": self.scenario_name,
            "lifecycle_status": self.lifecycle_status,
            "publish_status": self.publish_status,
            "recommendation": self.recommendation,
            "comparison": self.comparison,
            "metadata": {
                "strategy": self.metadata.strategy,
                "solver_status": self.metadata.solver_status,
                "objective_value": self.metadata.objective_value,
                "workspace_id": self.metadata.workspace_id,
                "organization_id": self.metadata.organization_id,
                "horizon_start": self.metadata.horizon_start,
                "horizon_end": self.metadata.horizon_end,
                "input_snapshot_hash": self.metadata.input_snapshot_hash,
                "engine_version": self.metadata.engine_version,
            },
        }


class PublishScenario:
    """Promote a candidate schedule run to the published lifecycle."""

    def __init__(self, repository: ScheduleRepository) -> None:
        self._repository = repository

    def execute(self, command: PublishScenarioInput) -> PublishScenarioOutput:
        metadata = self._load_metadata(command.schedule_id, command.organization_id)
        assessment = self._assess(command, metadata)
        if assessment.publish_status == "blocked":
            raise ValidationError(assessment.recommendation)
        if assessment.publish_status == "review" and not command.allow_review:
            raise ValidationError(
                f"{assessment.recommendation} Re-run with allow_review=True to publish anyway."
            )

        updated = self._repository.update_context(
            command.schedule_id,
            scenario_name=command.scenario_name,
            lifecycle_status="published",
        )
        if updated is None:
            raise ValidationError(f"Schedule {command.schedule_id!r} not found")
        return PublishScenarioOutput(
            schedule_id=command.schedule_id,
            scenario_name=updated.scenario_name,
            lifecycle_status=updated.lifecycle_status,
            publish_status=assessment.publish_status,
            recommendation=assessment.recommendation,
            comparison=assessment.comparison,
            metadata=updated,
        )

    def assess(self, command: PublishScenarioInput) -> dict[str, object]:
        """Read-only preview of the exact gate used by execute; never changes lifecycle."""
        metadata = self._load_metadata(command.schedule_id, command.organization_id)
        assessment = self._assess(command, metadata)
        return {
            "publish_status": assessment.publish_status,
            "recommendation": assessment.recommendation,
            "comparison": assessment.comparison,
        }

    def _assess(
        self,
        command: PublishScenarioInput,
        metadata: ScheduleRunMetadata,
    ) -> _PublishAssessment:
        if command.baseline_schedule_id is not None:
            comparison = CompareScenarios(self._repository).execute(
                CompareScenariosInput(
                    baseline_schedule_id=command.baseline_schedule_id,
                    candidate_schedule_ids=[command.schedule_id],
                    organization_id=command.organization_id,
                )
            )
            card = comparison.comparisons[0]
            return _PublishAssessment.from_comparison(card)

        if metadata.solver_status != "feasible":
            return _PublishAssessment(
                publish_status="blocked",
                recommendation="Do not publish an infeasible or failed scenario.",
                comparison=None,
            )
        planner_exceptions = metadata.diagnostics.get("planner_exceptions")
        if isinstance(planner_exceptions, dict) and planner_exceptions.get("status") == "blocked":
            return _PublishAssessment(
                publish_status="blocked",
                recommendation="Resolve planner exceptions before publishing.",
                comparison=None,
            )
        return _PublishAssessment(
            publish_status="publishable",
            recommendation="Scenario can be published.",
            comparison=None,
        )

    def _load_metadata(
        self,
        schedule_id: str,
        organization_id: str | None,
    ) -> ScheduleRunMetadata:
        metadata = self._repository.get_metadata(schedule_id)
        if metadata is None or self._repository.get(schedule_id) is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Candidate",
        )
        return metadata


@dataclass(frozen=True, slots=True)
class _PublishAssessment:
    publish_status: str
    recommendation: str
    comparison: dict[str, object] | None

    @classmethod
    def from_comparison(cls, card: ScenarioComparisonCard) -> _PublishAssessment:
        return cls(
            publish_status=card.publish_status,
            recommendation=card.recommendation,
            comparison=card.as_dict(),
        )
