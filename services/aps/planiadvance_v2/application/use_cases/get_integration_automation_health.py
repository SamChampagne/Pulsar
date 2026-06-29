"""Use case: summarize integration automation operational health."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..ports import IntegrationAutomationJob, IntegrationAutomationRepository
from .run_due_integration_automations import evaluate_integration_automation_schedule


@dataclass(slots=True)
class GetIntegrationAutomationHealthInput:
    organization_id: str | None = None
    workspace_id: str | None = None
    limit: int = 200
    now: datetime | None = None


@dataclass(slots=True)
class IntegrationAutomationHealthIssue:
    job: IntegrationAutomationJob
    status: str
    severity: str
    message: str
    next_action: str
    next_run_at: datetime | None = None


@dataclass(slots=True)
class GetIntegrationAutomationHealthOutput:
    generated_at: datetime
    status: str
    summary: dict[str, int] = field(default_factory=dict)
    issues: list[IntegrationAutomationHealthIssue] = field(default_factory=list)
    jobs: list[IntegrationAutomationJob] = field(default_factory=list)


class GetIntegrationAutomationHealth:
    def __init__(self, automations: IntegrationAutomationRepository) -> None:
        self._automations = automations

    def execute(
        self,
        command: GetIntegrationAutomationHealthInput,
    ) -> GetIntegrationAutomationHealthOutput:
        now = command.now or datetime.utcnow()
        limit = max(1, min(command.limit, 200))
        jobs = self._automations.list_for_scope(
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            limit=limit,
        )
        summary = _empty_summary()
        issues: list[IntegrationAutomationHealthIssue] = []

        for job in jobs:
            evaluation = evaluate_integration_automation_schedule(job, now)
            _count_job(summary, job)
            _count_evaluation(summary, job, evaluation.status, evaluation.due)
            _count_runtime_state(summary, job, now)

            issue = _build_issue(job, evaluation, now)
            if issue is not None:
                issues.append(issue)
                if issue.severity == "critical":
                    summary["critical_count"] += 1
                elif issue.severity == "warning":
                    summary["warning_count"] += 1
                else:
                    summary["info_count"] += 1

        summary["issue_count"] = len(issues)
        status = _overall_status(summary)
        return GetIntegrationAutomationHealthOutput(
            generated_at=now,
            status=status,
            summary=summary,
            issues=_sort_issues(issues),
            jobs=jobs,
        )


def _empty_summary() -> dict[str, int]:
    return {
        "total_count": 0,
        "enabled_count": 0,
        "disabled_count": 0,
        "scheduled_count": 0,
        "manual_count": 0,
        "webhook_count": 0,
        "due_count": 0,
        "not_due_count": 0,
        "locked_count": 0,
        "stale_lock_count": 0,
        "retry_wait_count": 0,
        "retry_exhausted_count": 0,
        "failed_count": 0,
        "blocked_count": 0,
        "missing_schedule_count": 0,
        "critical_count": 0,
        "warning_count": 0,
        "info_count": 0,
        "issue_count": 0,
    }


def _count_job(summary: dict[str, int], job: IntegrationAutomationJob) -> None:
    summary["total_count"] += 1
    if job.is_enabled:
        summary["enabled_count"] += 1
    else:
        summary["disabled_count"] += 1

    trigger = job.trigger_type.strip().lower()
    if trigger == "scheduled":
        summary["scheduled_count"] += 1
    elif trigger == "manual":
        summary["manual_count"] += 1
    elif trigger == "webhook":
        summary["webhook_count"] += 1

    if job.last_status == "failed":
        summary["failed_count"] += 1
    elif job.last_status == "blocked":
        summary["blocked_count"] += 1


def _count_evaluation(
    summary: dict[str, int],
    job: IntegrationAutomationJob,
    status: str,
    due: bool,
) -> None:
    if due:
        summary["due_count"] += 1
    elif status == "not_due":
        summary["not_due_count"] += 1
    elif status == "backoff":
        summary["retry_wait_count"] += 1
    elif status == "retry_exhausted":
        summary["retry_exhausted_count"] += 1
    elif status == "skipped" and _is_enabled_scheduled_job(job):
        summary["missing_schedule_count"] += 1


def _count_runtime_state(
    summary: dict[str, int],
    job: IntegrationAutomationJob,
    now: datetime,
) -> None:
    if job.locked_until is not None and job.locked_until > now:
        summary["locked_count"] += 1
    elif job.lock_owner and job.locked_until is not None and job.locked_until <= now:
        summary["stale_lock_count"] += 1


def _build_issue(
    job: IntegrationAutomationJob,
    evaluation,
    now: datetime,
) -> IntegrationAutomationHealthIssue | None:
    if evaluation.status == "retry_exhausted":
        return IntegrationAutomationHealthIssue(
            job=job,
            status="retry_exhausted",
            severity="critical",
            message=(
                "Scheduled automation reached its retry limit"
                f"{_error_suffix(job)}."
            ),
            next_action="Fix the connector/data issue, then run the job manually or update its retry config.",
            next_run_at=evaluation.next_run_at,
        )

    if job.last_status == "blocked":
        return IntegrationAutomationHealthIssue(
            job=job,
            status="blocked",
            severity="critical",
            message="Last run was blocked by planning snapshot validation.",
            next_action="Open the journal details, fix source data, validate again, then import.",
            next_run_at=evaluation.next_run_at,
        )

    if job.locked_until is not None and job.locked_until > now:
        return IntegrationAutomationHealthIssue(
            job=job,
            status="locked",
            severity="warning",
            message=(
                f"Automation is claimed by {job.lock_owner or 'a worker'} "
                f"until {job.locked_until.isoformat()}."
            ),
            next_action="Check the active worker if the lock does not clear after the TTL.",
            next_run_at=evaluation.next_run_at,
        )

    if job.lock_owner and job.locked_until is not None and job.locked_until <= now:
        return IntegrationAutomationHealthIssue(
            job=job,
            status="stale_lock",
            severity="warning",
            message="Automation lock expired without a clean release.",
            next_action="Let the next worker pass reclaim it, or inspect worker shutdown logs.",
            next_run_at=evaluation.next_run_at,
        )

    if evaluation.status == "backoff":
        return IntegrationAutomationHealthIssue(
            job=job,
            status="backoff",
            severity="warning",
            message=f"Automation is waiting for retry backoff{_error_suffix(job)}.",
            next_action="Fix the connector issue or wait for the scheduled retry.",
            next_run_at=evaluation.next_run_at,
        )

    if job.last_status == "failed":
        return IntegrationAutomationHealthIssue(
            job=job,
            status="failed",
            severity="critical",
            message=f"Last run failed{_error_suffix(job)}.",
            next_action="Open the journal, fix the connector/config, then run again.",
            next_run_at=evaluation.next_run_at,
        )

    if evaluation.status == "skipped" and _is_enabled_scheduled_job(job):
        return IntegrationAutomationHealthIssue(
            job=job,
            status="missing_schedule",
            severity="warning",
            message="Scheduled automation has no valid interval configured.",
            next_action="Set config.schedule.interval_minutes or config.cadence.",
            next_run_at=None,
        )

    if job.trigger_type.strip().lower() == "scheduled" and not job.is_enabled:
        return IntegrationAutomationHealthIssue(
            job=job,
            status="disabled",
            severity="info",
            message="Scheduled automation is disabled.",
            next_action="Enable it when this ERP/MES flow should run again.",
            next_run_at=None,
        )

    if evaluation.due:
        return IntegrationAutomationHealthIssue(
            job=job,
            status=evaluation.status,
            severity="info",
            message=evaluation.message,
            next_action="Run due automations or confirm the background worker is active.",
            next_run_at=evaluation.next_run_at,
        )

    return None


def _is_enabled_scheduled_job(job: IntegrationAutomationJob) -> bool:
    return job.is_enabled and job.trigger_type.strip().lower() == "scheduled"


def _error_suffix(job: IntegrationAutomationJob) -> str:
    if not job.last_error_code:
        return ""
    return f" ({job.last_error_code})"


def _overall_status(summary: dict[str, int]) -> str:
    if summary["critical_count"] > 0 or summary["retry_exhausted_count"] > 0:
        return "blocked"
    if (
        summary["warning_count"] > 0
        or summary["due_count"] > 0
        or summary["retry_wait_count"] > 0
        or summary["locked_count"] > 0
    ):
        return "attention"
    return "healthy"


def _sort_issues(
    issues: list[IntegrationAutomationHealthIssue],
) -> list[IntegrationAutomationHealthIssue]:
    severity_rank = {"critical": 0, "warning": 1, "info": 2}
    return sorted(
        issues,
        key=lambda issue: (
            severity_rank.get(issue.severity, 9),
            issue.next_run_at or datetime.max,
            issue.job.name,
        ),
    )
