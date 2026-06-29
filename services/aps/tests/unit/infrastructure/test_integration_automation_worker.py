from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta

from planiadvance_v2.application.ports import IntegrationAutomationJob, IntegrationJournalEntry
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunDueIntegrationAutomations,
    RunDueIntegrationAutomationsInput,
    RunIntegrationAutomation,
    RunIntegrationAutomationOutput,
)
from planiadvance_v2.infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryIntegrationAutomationRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from planiadvance_v2.infrastructure.integration_automation_worker import (
    IntegrationAutomationWorker,
    IntegrationAutomationWorkerConfig,
    output_to_dict,
)
from tests.support.reference_scenarios import build_stressed_reference_workshop


def test_integration_automation_worker_runs_due_jobs_once_then_skips_until_next_interval():
    workshop = build_stressed_reference_workshop()
    work_orders = InMemoryWorkOrderRepository(workshop.work_orders)
    machines = InMemoryMachineRepository(workshop.machines)
    calendars = InMemoryCalendarRepository(workshop.calendars)
    resources = InMemoryResourceRepository(workshop.resources)
    inventory = InMemoryInventoryRepository()
    supplies = InMemorySupplyRepository()
    bindings = InMemoryIntegrationBindingRepository()
    journal = InMemoryIntegrationJournalRepository()
    automations = InMemoryIntegrationAutomationRepository(
        [
            IntegrationAutomationJob(
                id="job-scheduled",
                name="Scheduled outbound",
                direction="outbound",
                trigger_type="scheduled",
                source_system="erp-worker",
                config={
                    "mode": "snapshot_export",
                    "schedule": {"interval_minutes": 30},
                    "metadata": {"site_id": "plant-worker"},
                },
            ),
            IntegrationAutomationJob(
                id="job-manual",
                name="Manual outbound",
                direction="outbound",
                trigger_type="manual",
                source_system="erp-worker",
                config={"mode": "snapshot_export"},
            ),
        ]
    )

    @contextmanager
    def runner_factory():
        yield RunDueIntegrationAutomations(
            automations=automations,
            runner=RunIntegrationAutomation(
                automations=automations,
                journal=journal,
                exporter=ExportPlanningSnapshot(
                    work_orders=work_orders,
                    machines=machines,
                    calendars=calendars,
                    resources=resources,
                    inventory=inventory,
                    supplies=supplies,
                ),
                plan_exporter=ExportPublishedPlan(InMemoryScheduleRepository()),
                importer=ImportPlanningSnapshot(
                    work_orders=work_orders,
                    machines=machines,
                    calendars=calendars,
                    resources=resources,
                    inventory=inventory,
                    supplies=supplies,
                    bindings=bindings,
                ),
            ),
        )

    worker = IntegrationAutomationWorker(
        runner_factory=runner_factory,
        config=IntegrationAutomationWorkerConfig(
            poll_interval_seconds=0,
            limit=10,
            max_iterations=2,
        ),
    )

    outputs = worker.run_loop()

    assert len(outputs) == 2
    assert outputs[0].checked_count == 2
    assert outputs[0].due_count == 1
    assert outputs[0].executed_count == 1
    assert outputs[0].failed_count == 0
    assert outputs[1].due_count == 0
    assert outputs[1].executed_count == 0

    entries = journal.list_recent(action="automation_outbound")
    assert len(entries) == 1
    assert entries[0].details["auth_mode"] == "worker"
    assert entries[0].details["triggered_by"] == "scheduled_due_runner"
    assert entries[0].details["worker_id"]
    payload = output_to_dict(outputs[0])
    assert payload["executed_count"] == 1
    assert payload["locked_count"] == 0
    assert payload["results"][0]["job_id"]


def test_due_runner_skips_job_claimed_by_another_worker():
    now = datetime(2026, 1, 5, 8, 0, 0)
    automations = InMemoryIntegrationAutomationRepository(
        [
            IntegrationAutomationJob(
                id="job-locked",
                name="Locked scheduled outbound",
                direction="outbound",
                trigger_type="scheduled",
                source_system="erp-worker",
                config={"mode": "snapshot_export", "schedule": {"interval_minutes": 30}},
                lock_owner="other-worker",
                locked_until=now + timedelta(minutes=10),
            )
        ]
    )
    use_case = RunDueIntegrationAutomations(
        automations=automations,
        runner=object(),
    )

    result = use_case.execute(
        RunDueIntegrationAutomationsInput(
            now=now,
            lock_owner="this-worker",
        )
    )

    assert result.checked_count == 1
    assert result.due_count == 0
    assert result.executed_count == 0
    assert result.locked_count == 1
    assert result.results[0].status == "locked"
    assert result.results[0].result["lock_owner"] == "other-worker"


def test_due_runner_schedules_retry_backoff_after_failed_execution():
    now = datetime(2026, 1, 5, 8, 0, 0)
    automations = InMemoryIntegrationAutomationRepository(
        [
            IntegrationAutomationJob(
                id="job-retry",
                name="Retry scheduled outbound",
                direction="outbound",
                trigger_type="scheduled",
                source_system="erp-worker",
                config={
                    "mode": "unsupported",
                    "schedule": {"interval_minutes": 30},
                    "retry": {"base_delay_seconds": 120, "max_attempts": 3},
                },
            )
        ]
    )
    use_case = RunDueIntegrationAutomations(
        automations=automations,
        runner=_FailingRunner(automations),
    )

    first = use_case.execute(
        RunDueIntegrationAutomationsInput(now=now, lock_owner="worker-a")
    )
    second = use_case.execute(
        RunDueIntegrationAutomationsInput(
            now=now + timedelta(seconds=30),
            lock_owner="worker-a",
        )
    )

    failed_job = automations.get("job-retry")
    assert first.due_count == 1
    assert first.failed_count == 1
    assert first.results[0].status == "failed"
    assert failed_job is not None
    assert failed_job.attempt_count == 1
    assert failed_job.next_attempt_at == now + timedelta(seconds=120)
    assert failed_job.last_error_code == "temporary_connector_error"
    assert failed_job.lock_owner is None
    assert failed_job.locked_until is None

    assert second.due_count == 0
    assert second.retry_wait_count == 1
    assert second.results[0].status == "backoff"
    assert second.results[0].next_run_at == now + timedelta(seconds=120)


def test_due_runner_stops_retrying_after_max_attempts():
    now = datetime(2026, 1, 5, 8, 0, 0)
    automations = InMemoryIntegrationAutomationRepository(
        [
            IntegrationAutomationJob(
                id="job-exhausted",
                name="Exhausted scheduled outbound",
                direction="outbound",
                trigger_type="scheduled",
                source_system="erp-worker",
                config={
                    "mode": "unsupported",
                    "schedule": {"interval_minutes": 30},
                    "retry": {"base_delay_seconds": 60, "max_attempts": 1},
                },
            )
        ]
    )
    use_case = RunDueIntegrationAutomations(
        automations=automations,
        runner=_FailingRunner(automations),
    )

    first = use_case.execute(
        RunDueIntegrationAutomationsInput(now=now, lock_owner="worker-a")
    )
    second = use_case.execute(
        RunDueIntegrationAutomationsInput(
            now=now + timedelta(minutes=30),
            lock_owner="worker-a",
        )
    )

    failed_job = automations.get("job-exhausted")
    assert first.failed_count == 1
    assert failed_job is not None
    assert failed_job.attempt_count == 1
    assert failed_job.next_attempt_at is None
    assert second.due_count == 0
    assert second.results[0].status == "retry_exhausted"


class _FailingRunner:
    def __init__(self, automations: InMemoryIntegrationAutomationRepository) -> None:
        self._automations = automations

    def execute(self, command) -> RunIntegrationAutomationOutput:
        job = self._automations.get(command.job_id)
        assert job is not None
        job.last_status = "failed"
        job.last_message = "Temporary connector error."
        job.last_run_at = datetime(2026, 1, 5, 8, 0, 0)
        saved = self._automations.save(job)
        return RunIntegrationAutomationOutput(
            job=saved,
            journal_entry=IntegrationJournalEntry(
                id="ij-failed",
                action="automation_outbound",
                source_system=saved.source_system,
                status="failed",
                valid=False,
                error_count=1,
            ),
            message="Temporary connector error.",
            result={"error_code": "temporary_connector_error"},
        )
