"""Integration automation worker composition.

The worker is intentionally thin: scheduling cadence lives here, while the
automation execution contract stays in the application use case.
"""

from __future__ import annotations

import json
import logging
import socket
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from ..application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunDueIntegrationAutomations,
    RunDueIntegrationAutomationsInput,
    RunDueIntegrationAutomationsOutput,
    RunIntegrationAutomation,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
from .db import SessionFactory, get_session_factory
from .db.repositories import (
    SqlCalendarRepository,
    SqlFlowRunTraceRepository,
    SqlIntegrationAutomationRepository,
    SqlIntegrationBindingRepository,
    SqlIntegrationConnectorRepository,
    SqlIntegrationExecutionRepository,
    SqlIntegrationFlowRepository,
    SqlIntegrationJournalRepository,
    SqlInventoryRepository,
    SqlMachineRepository,
    SqlResourceRepository,
    SqlScheduleRepository,
    SqlSupplyRepository,
    SqlWorkOrderRepository,
)
from .integration_database import SqlAlchemyIntegrationDatabaseTransport
from .integration_http import EnvIntegrationSecretResolver, UrllibIntegrationHttpTransport
from .integration_sftp import ParamikoIntegrationSftpTransport

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class IntegrationAutomationWorkerConfig:
    poll_interval_seconds: float = 60.0
    limit: int = 50
    dry_run: bool = False
    organization_id: str | None = None
    workspace_id: str | None = None
    worker_id: str | None = None
    lock_ttl_seconds: int = 900
    max_iterations: int | None = None


RunnerFactory = Callable[[], AbstractContextManager[RunDueIntegrationAutomations]]


class IntegrationAutomationWorker:
    def __init__(
        self,
        *,
        runner_factory: RunnerFactory,
        config: IntegrationAutomationWorkerConfig | None = None,
    ) -> None:
        self._runner_factory = runner_factory
        self._config = config or IntegrationAutomationWorkerConfig()
        self._worker_id = self._config.worker_id or _default_worker_id()

    def run_once(self, *, now: datetime | None = None) -> RunDueIntegrationAutomationsOutput:
        with self._runner_factory() as runner:
            output = runner.execute(
                RunDueIntegrationAutomationsInput(
                    organization_id=self._config.organization_id,
                    workspace_id=self._config.workspace_id,
                    limit=self._config.limit,
                    dry_run=self._config.dry_run,
                    now=now,
                    lock_owner=self._worker_id,
                    lock_ttl_seconds=self._config.lock_ttl_seconds,
                    actor_details={
                        "auth_mode": "worker",
                        "worker_id": self._worker_id,
                    },
                )
            )
        _log_output(output)
        return output

    def run_loop(self) -> list[RunDueIntegrationAutomationsOutput]:
        outputs: list[RunDueIntegrationAutomationsOutput] = []
        iteration = 0
        while True:
            try:
                outputs.append(self.run_once())
            except Exception:
                logger.exception("Integration automation worker pass failed.")
            iteration += 1
            if (
                self._config.max_iterations is not None
                and iteration >= self._config.max_iterations
            ):
                return outputs
            time.sleep(max(0.0, self._config.poll_interval_seconds))


def create_sql_integration_automation_worker(
    config: IntegrationAutomationWorkerConfig | None = None,
    *,
    session_factory: SessionFactory | None = None,
) -> IntegrationAutomationWorker:
    factory = session_factory or get_session_factory()

    @contextmanager
    def _runner_factory() -> Iterator[RunDueIntegrationAutomations]:
        with factory.session() as session:
            yield _build_runner(session)

    return IntegrationAutomationWorker(
        runner_factory=_runner_factory,
        config=config,
    )


def output_to_dict(output: RunDueIntegrationAutomationsOutput) -> dict[str, object]:
    return {
        "checked_count": output.checked_count,
        "due_count": output.due_count,
        "executed_count": output.executed_count,
        "skipped_count": output.skipped_count,
        "failed_count": output.failed_count,
        "locked_count": output.locked_count,
        "retry_wait_count": output.retry_wait_count,
        "dry_run": output.dry_run,
        "results": [
            {
                "job_id": item.job.id,
                "name": item.job.name,
                "direction": item.job.direction,
                "trigger_type": item.job.trigger_type,
                "source_system": item.job.source_system,
                "workspace_id": item.job.workspace_id,
                "attempt_count": item.job.attempt_count,
                "next_attempt_at": (
                    item.job.next_attempt_at.isoformat() if item.job.next_attempt_at else None
                ),
                "last_error_code": item.job.last_error_code,
                "due": item.due,
                "status": item.status,
                "message": item.message,
                "last_run_at": item.last_run_at.isoformat() if item.last_run_at else None,
                "next_run_at": item.next_run_at.isoformat() if item.next_run_at else None,
                "result": item.result,
            }
            for item in output.results
        ],
    }


def output_to_json(output: RunDueIntegrationAutomationsOutput) -> str:
    return json.dumps(output_to_dict(output), indent=2, default=str)


def _build_runner(session: Session) -> RunDueIntegrationAutomations:
    automations = SqlIntegrationAutomationRepository(session)
    return RunDueIntegrationAutomations(
        automations=automations,
        runner=RunIntegrationAutomation(
            automations=automations,
            journal=SqlIntegrationJournalRepository(session),
            exporter=ExportPlanningSnapshot(
                work_orders=SqlWorkOrderRepository(session),
                machines=SqlMachineRepository(session),
                calendars=SqlCalendarRepository(session),
                resources=SqlResourceRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
            ),
            plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
            importer=ImportPlanningSnapshot(
                calendars=SqlCalendarRepository(session),
                machines=SqlMachineRepository(session),
                resources=SqlResourceRepository(session),
                work_orders=SqlWorkOrderRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
                bindings=SqlIntegrationBindingRepository(session),
            ),
            connectors=SqlIntegrationConnectorRepository(session),
            secret_resolver=EnvIntegrationSecretResolver(),
            http_transport=UrllibIntegrationHttpTransport(),
            sftp_transport=ParamikoIntegrationSftpTransport(),
            flow_runner=RunIntegrationFlow(
                flows=SqlIntegrationFlowRepository(session),
                journal=SqlIntegrationJournalRepository(session),
                exporter=ExportPlanningSnapshot(
                    work_orders=SqlWorkOrderRepository(session),
                    machines=SqlMachineRepository(session),
                    calendars=SqlCalendarRepository(session),
                    resources=SqlResourceRepository(session),
                    inventory=SqlInventoryRepository(session),
                    supplies=SqlSupplyRepository(session),
                ),
                plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
                importer=ImportPlanningSnapshot(
                    calendars=SqlCalendarRepository(session),
                    machines=SqlMachineRepository(session),
                    resources=SqlResourceRepository(session),
                    work_orders=SqlWorkOrderRepository(session),
                    inventory=SqlInventoryRepository(session),
                    supplies=SqlSupplyRepository(session),
                    bindings=SqlIntegrationBindingRepository(session),
                ),
                scheduler=RunSchedulingFromSnapshot(),
                connectors=SqlIntegrationConnectorRepository(session),
                secret_resolver=EnvIntegrationSecretResolver(),
                http_transport=UrllibIntegrationHttpTransport(),
                database_transport=SqlAlchemyIntegrationDatabaseTransport(),
                sftp_transport=ParamikoIntegrationSftpTransport(),
                executions=SqlIntegrationExecutionRepository(session),
                flow_run_traces=SqlFlowRunTraceRepository(session),
                bindings=SqlIntegrationBindingRepository(session),
            ),
        ),
    )


def _log_output(output: RunDueIntegrationAutomationsOutput) -> None:
    logger.info(
        "Integration automation worker pass: checked=%s due=%s executed=%s skipped=%s failed=%s dry_run=%s",
        output.checked_count,
        output.due_count,
        output.executed_count,
        output.skipped_count,
        output.failed_count,
        output.dry_run,
    )


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{uuid4().hex[:12]}"
