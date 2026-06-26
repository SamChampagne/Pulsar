"""Use case: execute scheduled integration automations that are due."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import uuid4

from ..ports import IntegrationAutomationJob, IntegrationAutomationRepository
from .run_integration_automation import (
    RunIntegrationAutomation,
    RunIntegrationAutomationInput,
    RunIntegrationAutomationRejected,
)


@dataclass(slots=True)
class RunDueIntegrationAutomationsInput:
    organization_id: str | None = None
    workspace_id: str | None = None
    limit: int = 50
    dry_run: bool = False
    now: datetime | None = None
    lock_owner: str | None = None
    lock_ttl_seconds: int = 900
    actor_details: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class DueIntegrationAutomationResult:
    job: IntegrationAutomationJob
    due: bool
    status: str
    message: str
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    result: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class RunDueIntegrationAutomationsOutput:
    checked_count: int
    due_count: int
    executed_count: int
    skipped_count: int
    failed_count: int
    locked_count: int
    retry_wait_count: int
    dry_run: bool
    results: list[DueIntegrationAutomationResult]


class RunDueIntegrationAutomations:
    def __init__(
        self,
        *,
        automations: IntegrationAutomationRepository,
        runner: RunIntegrationAutomation,
    ) -> None:
        self._automations = automations
        self._runner = runner

    def execute(
        self, command: RunDueIntegrationAutomationsInput
    ) -> RunDueIntegrationAutomationsOutput:
        now = command.now or datetime.utcnow()
        limit = max(1, min(command.limit, 200))
        lock_owner = command.lock_owner or _lock_owner(command.actor_details)
        lock_ttl_seconds = max(1, command.lock_ttl_seconds)
        jobs = self._automations.list_for_scope(
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            limit=limit,
        )
        results: list[DueIntegrationAutomationResult] = []

        for job in jobs:
            evaluation = _evaluate_schedule(job, now)
            if not evaluation.due:
                results.append(
                    DueIntegrationAutomationResult(
                        job=job,
                        due=False,
                        status=evaluation.status,
                        message=evaluation.message,
                        last_run_at=job.last_run_at,
                        next_run_at=evaluation.next_run_at,
                    )
                )
                continue
            if command.dry_run:
                results.append(
                    DueIntegrationAutomationResult(
                        job=job,
                        due=True,
                        status="due",
                        message="Scheduled automation is due.",
                        last_run_at=job.last_run_at,
                        next_run_at=evaluation.next_run_at,
                    )
                )
                continue

            locked_until = now + timedelta(seconds=lock_ttl_seconds)
            claimed = self._automations.try_claim(
                job.id,
                owner_id=lock_owner,
                locked_until=locked_until,
                now=now,
                organization_id=command.organization_id,
            )
            if claimed is None:
                latest = self._automations.get(
                    job.id,
                    organization_id=command.organization_id,
                )
                locked_job = latest or job
                results.append(
                    DueIntegrationAutomationResult(
                        job=locked_job,
                        due=False,
                        status="locked",
                        message="Scheduled automation is already claimed by another worker.",
                        last_run_at=locked_job.last_run_at,
                        next_run_at=evaluation.next_run_at,
                        result={
                            "lock_owner": locked_job.lock_owner,
                            "locked_until": (
                                locked_job.locked_until.isoformat()
                                if locked_job.locked_until
                                else None
                            ),
                        },
                    )
                )
                continue

            released_job: IntegrationAutomationJob | None = None
            try:
                output = self._runner.execute(
                    RunIntegrationAutomationInput(
                        job_id=claimed.id,
                        organization_id=command.organization_id,
                        workspace_id=command.workspace_id,
                        actor_details={
                            **command.actor_details,
                            "lock_owner": lock_owner,
                            "triggered_by": "scheduled_due_runner",
                        },
                    )
                )
            except RunIntegrationAutomationRejected as exc:
                released_job = self._automations.release_claim(
                    claimed.id,
                    owner_id=lock_owner,
                    now=datetime.utcnow(),
                    organization_id=command.organization_id,
                )
                results.append(
                    DueIntegrationAutomationResult(
                        job=released_job or claimed,
                        due=True,
                        status="failed",
                        message=exc.message,
                        last_run_at=(released_job or claimed).last_run_at,
                        next_run_at=evaluation.next_run_at,
                        result={"error": exc.code},
                    )
                )
                continue
            except Exception as exc:
                released_job = self._automations.release_claim(
                    claimed.id,
                    owner_id=lock_owner,
                    now=datetime.utcnow(),
                    organization_id=command.organization_id,
                )
                results.append(
                    DueIntegrationAutomationResult(
                        job=released_job or claimed,
                        due=True,
                        status="failed",
                        message=f"Scheduled automation execution failed: {exc}",
                        last_run_at=(released_job or claimed).last_run_at,
                        next_run_at=evaluation.next_run_at,
                        result={"error": str(exc)},
                    )
                )
                continue

            final_job = output.job
            interval = _configured_interval_minutes(output.job.config)
            final_status = final_job.last_status or "executed"
            _apply_due_attempt_state(final_job, final_status, output.result, now)
            saved_job = self._automations.save(final_job)
            released_job = self._automations.release_claim(
                saved_job.id,
                owner_id=lock_owner,
                now=datetime.utcnow(),
                organization_id=command.organization_id,
            )
            final_job = released_job or saved_job
            next_run_at = final_job.next_attempt_at or _next_run_at(final_job, interval, now)
            results.append(
                DueIntegrationAutomationResult(
                    job=final_job,
                    due=True,
                    status=final_status,
                    message=output.message,
                    last_run_at=final_job.last_run_at,
                    next_run_at=next_run_at,
                    result={
                        "journal_entry_id": output.journal_entry.id,
                        "lock_owner": lock_owner,
                        **output.result,
                    },
                )
            )

        due_count = sum(1 for result in results if result.due)
        executed_count = sum(
            1
            for result in results
            if result.due and not command.dry_run and result.status != "failed"
        )
        failed_count = sum(1 for result in results if result.status == "failed")
        locked_count = sum(1 for result in results if result.status == "locked")
        retry_wait_count = sum(1 for result in results if result.status == "backoff")
        skipped_count = len(results) - due_count
        return RunDueIntegrationAutomationsOutput(
            checked_count=len(jobs),
            due_count=due_count,
            executed_count=executed_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            locked_count=locked_count,
            retry_wait_count=retry_wait_count,
            dry_run=command.dry_run,
            results=results,
        )


@dataclass(frozen=True, slots=True)
class _ScheduleEvaluation:
    due: bool
    status: str
    message: str
    next_run_at: datetime | None


def evaluate_integration_automation_schedule(
    job: IntegrationAutomationJob,
    now: datetime,
) -> _ScheduleEvaluation:
    return _evaluate_schedule(job, now)


def _evaluate_schedule(job: IntegrationAutomationJob, now: datetime) -> _ScheduleEvaluation:
    if not job.is_enabled:
        return _ScheduleEvaluation(
            due=False,
            status="skipped",
            message="Automation job is disabled.",
            next_run_at=None,
        )
    if job.trigger_type.strip().lower() != "scheduled":
        return _ScheduleEvaluation(
            due=False,
            status="skipped",
            message="Automation trigger is not scheduled.",
            next_run_at=None,
        )
    max_attempts = _retry_max_attempts(job.config)
    if (
        job.last_status == "failed"
        and max_attempts is not None
        and job.attempt_count >= max_attempts
        and job.next_attempt_at is None
    ):
        return _ScheduleEvaluation(
            due=False,
            status="retry_exhausted",
            message="Scheduled automation reached the configured retry limit.",
            next_run_at=None,
        )
    if job.next_attempt_at is not None:
        if job.next_attempt_at > now:
            return _ScheduleEvaluation(
                due=False,
                status="backoff",
                message="Scheduled automation is waiting for retry backoff.",
                next_run_at=job.next_attempt_at,
            )
        return _ScheduleEvaluation(
            due=True,
            status="retry_due",
            message="Scheduled automation retry is due.",
            next_run_at=job.next_attempt_at,
        )
    interval = _configured_interval_minutes(job.config)
    if interval is None:
        return _ScheduleEvaluation(
            due=False,
            status="skipped",
            message=(
                "Scheduled automation requires config.schedule.interval_minutes "
                "or config.interval_minutes."
            ),
            next_run_at=None,
        )
    next_run_at = _next_run_at(job, interval, now)
    if next_run_at is not None and next_run_at > now:
        return _ScheduleEvaluation(
            due=False,
            status="not_due",
            message="Scheduled automation is not due yet.",
            next_run_at=next_run_at,
        )
    return _ScheduleEvaluation(
        due=True,
        status="due",
        message="Scheduled automation is due.",
        next_run_at=next_run_at,
    )


def _next_run_at(
    job: IntegrationAutomationJob,
    interval_minutes: int | None,
    now: datetime,
) -> datetime | None:
    if interval_minutes is None:
        return None
    if job.last_run_at is None:
        return now
    return job.last_run_at + timedelta(minutes=interval_minutes)


def _configured_interval_minutes(config: dict[str, object]) -> int | None:
    schedule = config.get("schedule")
    schedule_config = schedule if isinstance(schedule, dict) else {}
    candidates = (
        schedule_config.get("interval_minutes"),
        schedule_config.get("every_minutes"),
        schedule_config.get("cadence_minutes"),
        config.get("interval_minutes"),
        config.get("every_minutes"),
        config.get("cadence_minutes"),
        schedule_config.get("cadence"),
        config.get("cadence"),
    )
    for candidate in candidates:
        minutes = _coerce_interval_minutes(candidate)
        if minutes is not None:
            return minutes
    return None


def _apply_due_attempt_state(
    job: IntegrationAutomationJob,
    status: str,
    result: dict[str, object],
    now: datetime,
) -> None:
    if status in {"exported", "imported"}:
        job.attempt_count = 0
        job.next_attempt_at = None
        job.last_error_code = None
        job.last_error_at = None
        return
    if status == "blocked":
        job.attempt_count = 0
        job.next_attempt_at = None
        job.last_error_code = "validation_blocked"
        job.last_error_at = now
        return
    if status != "failed":
        return

    job.attempt_count = max(0, job.attempt_count) + 1
    job.last_error_code = _error_code(result)
    job.last_error_at = now
    max_attempts = _retry_max_attempts(job.config)
    if max_attempts is not None and job.attempt_count >= max_attempts:
        job.next_attempt_at = None
        job.last_message = (
            f"{job.last_message or 'Automation execution failed'} "
            f"Retry limit reached after {job.attempt_count} attempt(s)."
        )
        return
    job.next_attempt_at = now + timedelta(seconds=_retry_backoff_seconds(job.config, job.attempt_count))


def _retry_max_attempts(config: dict[str, object]) -> int | None:
    raw_retry = config.get("retry")
    retry = raw_retry if isinstance(raw_retry, dict) else {}
    value = retry.get("max_attempts", config.get("max_attempts"))
    if value is None:
        return 5
    if isinstance(value, bool):
        return None
    try:
        attempts = int(value)
    except (TypeError, ValueError):
        return 5
    return attempts if attempts > 0 else None


def _retry_backoff_seconds(config: dict[str, object], attempt_count: int) -> int:
    raw_retry = config.get("retry")
    retry = raw_retry if isinstance(raw_retry, dict) else {}
    base = _positive_int(retry.get("base_delay_seconds", config.get("base_delay_seconds")), 60)
    max_delay = _positive_int(retry.get("max_delay_seconds", config.get("max_delay_seconds")), 3600)
    multiplier = _positive_float(retry.get("multiplier", config.get("multiplier")), 2.0)
    delay = int(base * (multiplier ** max(0, attempt_count - 1)))
    return max(1, min(delay, max_delay))


def _positive_int(value: object, default: int) -> int:
    if isinstance(value, bool) or value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def _positive_float(value: object, default: float) -> float:
    if isinstance(value, bool) or value is None:
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def _error_code(result: dict[str, object]) -> str:
    value = result.get("error_code") or result.get("error")
    if value is None or not str(value).strip():
        return "execution_failed"
    return str(value)[:64]


def _coerce_interval_minutes(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        minutes = int(value)
        return minutes if minutes > 0 else None
    text = str(value).strip().lower()
    if not text or text == "manual":
        return None
    aliases = {
        "hourly": 60,
        "daily": 1440,
    }
    if text in aliases:
        return aliases[text]
    for suffix in ("minutes", "minute", "mins", "min", "m"):
        if text.endswith(suffix):
            return _coerce_interval_minutes(text[: -len(suffix)].strip())
    for suffix in ("hours", "hour", "hrs", "hr", "h"):
        if text.endswith(suffix):
            hours = _coerce_interval_minutes(text[: -len(suffix)].strip())
            return hours * 60 if hours is not None else None
    try:
        minutes = int(text)
    except ValueError:
        return None
    return minutes if minutes > 0 else None


def _lock_owner(actor_details: dict[str, object]) -> str:
    for key in ("worker_id", "client_id", "lock_owner"):
        value = actor_details.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return f"due-runner-{uuid4().hex[:12]}"
