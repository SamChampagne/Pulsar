"""Use case: execute a configured ERP/MES integration automation job."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from ...application.integration import (
    CanonicalCsvBundle,
    snapshot_from_csv_bundle,
    validate_snapshot_report,
)
from ...application.integration.canonical_snapshot import CanonicalPlanningSnapshot
from ...application.integration.snapshot_codec import (
    planning_snapshot_from_json,
    planning_snapshot_hash,
    planning_snapshot_to_json,
)
from ..ports import (
    IntegrationAutomationJob,
    IntegrationAutomationRepository,
    IntegrationConnectorRepository,
    IntegrationCredentialRepository,
    IntegrationExecutionRepository,
    IntegrationHttpTransport,
    IntegrationJournalEntry,
    IntegrationJournalRepository,
    IntegrationSecretResolver,
    IntegrationSftpTransport,
)
from .export_planning_snapshot import ExportPlanningSnapshot, ExportPlanningSnapshotInput
from .export_published_plan import ExportPublishedPlan, ExportPublishedPlanInput
from .import_planning_snapshot import ImportPlanningSnapshot, ImportPlanningSnapshotInput
from .integration_connectors import build_connector_http_request
from .integration_credentials import apply_integration_credential
from .integration_execution_support import (
    ensure_integration_correlation_id,
    save_integration_execution,
)
from .integration_flows import RunIntegrationFlow, RunIntegrationFlowInput
from .integration_snapshot_support import (
    http_body_from_config,
    snapshot_entity_counts,
    transfer_times_from_config,
)


class RunIntegrationAutomationRejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(slots=True)
class RunIntegrationAutomationInput:
    job_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    actor_details: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class RunIntegrationAutomationOutput:
    job: IntegrationAutomationJob
    journal_entry: IntegrationJournalEntry
    message: str
    result: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _AutomationExecution:
    status: str
    valid: bool
    message: str
    entity_counts: dict[str, int]
    result: dict[str, object]
    error_count: int = 0
    warning_count: int = 0
    journal_details: dict[str, object] = field(default_factory=dict)


class RunIntegrationAutomation:
    def __init__(
        self,
        *,
        automations: IntegrationAutomationRepository,
        journal: IntegrationJournalRepository,
        exporter: ExportPlanningSnapshot,
        plan_exporter: ExportPublishedPlan,
        importer: ImportPlanningSnapshot,
        connectors: IntegrationConnectorRepository | None = None,
        credentials: IntegrationCredentialRepository | None = None,
        secret_resolver: IntegrationSecretResolver | None = None,
        http_transport: IntegrationHttpTransport | None = None,
        sftp_transport: IntegrationSftpTransport | None = None,
        flow_runner: RunIntegrationFlow | None = None,
        executions: IntegrationExecutionRepository | None = None,
    ) -> None:
        self._automations = automations
        self._journal = journal
        self._exporter = exporter
        self._plan_exporter = plan_exporter
        self._importer = importer
        self._connectors = connectors
        self._credentials = credentials
        self._secret_resolver = secret_resolver
        self._http_transport = http_transport
        self._sftp_transport = sftp_transport
        self._flow_runner = flow_runner
        self._executions = executions

    def execute(
        self, command: RunIntegrationAutomationInput
    ) -> RunIntegrationAutomationOutput:
        job = self._automations.get(
            command.job_id,
            organization_id=command.organization_id,
        )
        if job is None:
            raise RunIntegrationAutomationRejected(
                "automation_not_found",
                f"Integration automation job {command.job_id!r} was not found.",
            )
        if not job.is_enabled:
            raise RunIntegrationAutomationRejected(
                "automation_disabled",
                f"Integration automation job {command.job_id!r} is disabled.",
            )
        now = datetime.utcnow()
        actor_lock_owner = str(command.actor_details.get("lock_owner") or "")
        if (
            job.locked_until is not None
            and job.locked_until > now
            and job.lock_owner != actor_lock_owner
        ):
            raise RunIntegrationAutomationRejected(
                "automation_locked",
                f"Integration automation job {command.job_id!r} is already running.",
            )
        if (
            command.workspace_id is not None
            and job.workspace_id is not None
            and job.workspace_id != command.workspace_id
        ):
            raise RunIntegrationAutomationRejected(
                "cross_workspace_forbidden",
                "Automation job workspace does not match the active workspace.",
            )

        organization_id = job.organization_id or command.organization_id
        workspace_id = job.workspace_id or command.workspace_id
        actor_details = dict(command.actor_details)
        ensure_integration_correlation_id(actor_details)
        started_at = datetime.utcnow()
        attempt_number = max(1, job.attempt_count + 1)
        try:
            execution = self._execute_job(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details=actor_details,
            )
        except Exception as exc:
            execution = _AutomationExecution(
                status="failed",
                valid=False,
                message=f"Automation execution failed: {exc}",
                entity_counts={},
                error_count=1,
                result={
                    "error": str(exc),
                    "mode": _automation_mode(job),
                },
            )

        job.last_status = execution.status
        job.last_message = execution.message
        job.last_run_at = now
        _apply_base_attempt_state(job, execution, now)
        job.updated_at = now
        saved_job = self._automations.save(job)
        entry = self._save_journal_entry(
            job=saved_job,
            execution=execution,
            actor_details=actor_details,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        self._save_execution_record(
            job=saved_job,
            execution=execution,
            actor_details=actor_details,
            organization_id=organization_id,
            workspace_id=workspace_id,
            journal_entry=entry,
            attempt_number=attempt_number,
            started_at=started_at,
            finished_at=now,
        )
        return RunIntegrationAutomationOutput(
            job=saved_job,
            journal_entry=entry,
            message=execution.message,
            result=execution.result,
        )

    def _execute_job(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
        actor_details: dict[str, object],
    ) -> _AutomationExecution:
        direction = job.direction.strip().lower()
        if direction == "outbound":
            return self._run_outbound(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details=actor_details,
            )
        if direction == "inbound":
            return self._run_inbound(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details=actor_details,
            )
        raise ValueError(f"Unsupported automation direction {job.direction!r}")

    def _run_outbound(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
        actor_details: dict[str, object],
    ) -> _AutomationExecution:
        mode = _automation_mode(job) or "snapshot_export"
        if mode in {"flow", "flow_run"}:
            return self._run_flow(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details=actor_details,
            )
        if mode in {"published_plan_export", "export_published_plan"}:
            return self._run_outbound_published_plan(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        if mode in {
            "connector_published_plan_export",
            "http_published_plan_export",
        }:
            return self._run_outbound_published_plan_connector(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        if mode in {"connector_snapshot_export", "http_snapshot_export"}:
            return self._run_outbound_connector(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        if mode not in {"snapshot_export", "export_snapshot"}:
            raise ValueError(f"Unsupported outbound automation mode {mode!r}")
        snapshot = self._exporter.execute(
            ExportPlanningSnapshotInput(
                source_system=job.source_system,
                transfer_times=transfer_times_from_config(job.config),
                metadata=_config_dict(job.config, "metadata"),
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        )
        snapshot_json = planning_snapshot_to_json(snapshot)
        snapshot_hash = planning_snapshot_hash(snapshot_json)
        entity_counts = snapshot_entity_counts(snapshot)
        message = "Outbound automation exported a planning snapshot."
        return _AutomationExecution(
            status="exported",
            valid=True,
            message=message,
            entity_counts=entity_counts,
            result={
                "mode": "snapshot_export",
                "snapshot": snapshot_json,
                "snapshot_hash": snapshot_hash,
                "entity_counts": entity_counts,
            },
            journal_details={
                "mode": "snapshot_export",
                "snapshot_hash": snapshot_hash,
                "metadata": dict(snapshot.metadata),
            },
        )

    def _run_outbound_published_plan(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
    ) -> _AutomationExecution:
        exported = self._plan_exporter.execute(
            ExportPublishedPlanInput(
                source_system=job.source_system,
                organization_id=organization_id,
                workspace_id=workspace_id,
                schedule_id=_config_optional_str(job.config, "schedule_id"),
                compare_to_schedule_id=_config_optional_str(
                    job.config, "compare_to_schedule_id"
                ),
                mode=_published_plan_mode(job.config),
                metadata=_config_dict(job.config, "metadata"),
            )
        )
        payload = exported.as_dict()
        message = "Outbound automation exported the published APS plan."
        return _AutomationExecution(
            status="exported",
            valid=True,
            message=message,
            entity_counts=exported.entity_counts,
            result={
                "mode": "published_plan_export",
                "plan": payload,
                "plan_hash": exported.export_hash,
                "entity_counts": dict(exported.entity_counts),
                "change_counts": dict(exported.change_counts),
            },
            journal_details={
                "mode": "published_plan_export",
                "plan_hash": exported.export_hash,
                "schedule_id": exported.schedule_id,
                "compare_to_schedule_id": exported.compare_to_schedule_id,
                "plan_mode": exported.mode,
                "change_counts": dict(exported.change_counts),
            },
        )

    def _run_outbound_connector(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
    ) -> _AutomationExecution:
        connector = self._require_connector(
            job,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        if connector.method == "GET":
            raise ValueError(
                f"Connector {connector.id!r} must use POST/PUT/PATCH for outbound snapshot export."
            )
        snapshot = self._exporter.execute(
            ExportPlanningSnapshotInput(
                source_system=job.source_system,
                transfer_times=transfer_times_from_config(job.config),
                metadata=_config_dict(job.config, "metadata"),
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        )
        snapshot_json = planning_snapshot_to_json(snapshot)
        snapshot_hash = planning_snapshot_hash(snapshot_json)
        body = json.dumps(snapshot_json).encode("utf-8")
        request = build_connector_http_request(
            connector,
            secret_resolver=self._secret_resolver,
            body=body,
            extra_headers={
                "Content-Type": "application/json",
                "X-PlaniAdvance-Job-Id": job.id,
                "X-PlaniAdvance-Mode": "connector_snapshot_export",
            },
        )
        response = self._send_connector_request(request)
        preview = response.body.decode("utf-8", errors="replace")[:500]
        if response.status_code < 200 or response.status_code >= 300:
            raise ValueError(
                f"Connector {connector.id!r} responded with HTTP {response.status_code}."
            )
        entity_counts = snapshot_entity_counts(snapshot)
        return _AutomationExecution(
            status="exported",
            valid=True,
            message="Outbound automation exported a planning snapshot to the connector.",
            entity_counts=entity_counts,
            result={
                "mode": "connector_snapshot_export",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_preview": preview,
                "snapshot_hash": snapshot_hash,
                "entity_counts": entity_counts,
            },
            journal_details={
                "mode": "connector_snapshot_export",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_size_bytes": len(response.body),
                "snapshot_hash": snapshot_hash,
            },
        )

    def _run_outbound_published_plan_connector(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
    ) -> _AutomationExecution:
        connector = self._require_connector(
            job,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        if connector.method == "GET":
            raise ValueError(
                f"Connector {connector.id!r} must use POST/PUT/PATCH for outbound published plan export."
            )
        exported = self._plan_exporter.execute(
            ExportPublishedPlanInput(
                source_system=job.source_system,
                organization_id=organization_id,
                workspace_id=workspace_id,
                schedule_id=_config_optional_str(job.config, "schedule_id"),
                compare_to_schedule_id=_config_optional_str(
                    job.config, "compare_to_schedule_id"
                ),
                mode=_published_plan_mode(job.config),
                metadata=_config_dict(job.config, "metadata"),
            )
        )
        payload = exported.as_dict()
        request = build_connector_http_request(
            connector,
            secret_resolver=self._secret_resolver,
            body=json.dumps(payload).encode("utf-8"),
            extra_headers={
                "Content-Type": "application/json",
                "X-PlaniAdvance-Job-Id": job.id,
                "X-PlaniAdvance-Mode": "connector_published_plan_export",
            },
        )
        response = self._send_connector_request(request)
        preview = response.body.decode("utf-8", errors="replace")[:500]
        if response.status_code < 200 or response.status_code >= 300:
            raise ValueError(
                f"Connector {connector.id!r} responded with HTTP {response.status_code}."
            )
        return _AutomationExecution(
            status="exported",
            valid=True,
            message="Outbound automation exported the published APS plan to the connector.",
            entity_counts=exported.entity_counts,
            result={
                "mode": "connector_published_plan_export",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_preview": preview,
                "plan_hash": exported.export_hash,
                "entity_counts": dict(exported.entity_counts),
                "change_counts": dict(exported.change_counts),
            },
            journal_details={
                "mode": "connector_published_plan_export",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_size_bytes": len(response.body),
                "plan_hash": exported.export_hash,
                "schedule_id": exported.schedule_id,
                "compare_to_schedule_id": exported.compare_to_schedule_id,
                "plan_mode": exported.mode,
                "change_counts": dict(exported.change_counts),
            },
        )

    def _run_inbound(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
        actor_details: dict[str, object],
    ) -> _AutomationExecution:
        mode = _automation_mode(job)
        if mode in {"", None}:
            mode = "snapshot_import" if "snapshot" in job.config else "csv_import"
        if mode in {"flow", "flow_run"}:
            return self._run_flow(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details=actor_details,
            )
        if mode in {"snapshot_import", "import_snapshot"}:
            snapshot = _snapshot_from_config(job.config)
            return self._import_snapshot(
                job,
                snapshot=snapshot,
                mode="snapshot_import",
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        if mode in {"csv_import", "import_csv"}:
            snapshot = _csv_snapshot_from_config(job.config)
            return self._import_snapshot(
                job,
                snapshot=snapshot,
                mode="csv_import",
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        if mode in {"connector_snapshot_import", "http_snapshot_import"}:
            return self._run_inbound_connector(
                job,
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        raise ValueError(f"Unsupported inbound automation mode {mode!r}")

    def _run_flow(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
        actor_details: dict[str, object],
    ) -> _AutomationExecution:
        if self._flow_runner is None:
            raise ValueError("Flow execution dependency is not configured.")
        flow_id = str(job.config.get("flow_id") or "").strip()
        if not flow_id:
            raise ValueError("Flow-backed automation requires config.flow_id.")
        executed = self._flow_runner.execute(
            RunIntegrationFlowInput(
                flow_id=flow_id,
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_details={
                    "automation_job_id": job.id,
                    **actor_details,
                    "triggered_by": "automation_job",
                },
                journal_action=None,
            )
        )
        block_results = [
            {
                "block_id": item.block_id,
                "block_type": item.block_type,
                "status": item.status,
                "message": item.message,
                "input_preview": item.input_preview,
                "output_preview": item.output_preview,
                "output_summary": item.output_summary,
            }
            for item in executed.block_results
        ]
        final_result = dict(executed.result)
        final_result.update(
            {
                "mode": "flow",
                "flow_id": executed.flow.id,
                "flow_name": executed.flow.name,
                "execution_scope": dict(executed.execution_scope),
                "block_results": block_results,
            }
        )
        status = executed.status
        valid = status != "blocked"
        error_count = 1 if status == "failed" else 0
        warning_count = 0
        if status == "blocked":
            validation = final_result.get("validation")
            if isinstance(validation, dict):
                error_count = int(validation.get("error_count", 0))
                warning_count = int(validation.get("warning_count", 0))
        return _AutomationExecution(
            status=status,
            valid=valid,
            message=executed.message,
            entity_counts={},
            error_count=error_count,
            warning_count=warning_count,
            result=final_result,
            journal_details={
                "mode": "flow",
                "flow_id": executed.flow.id,
                "flow_name": executed.flow.name,
                "flow_block_count": len(executed.flow.blocks),
                "final_output": _flow_result_summary(executed.result),
            },
        )

    def _run_inbound_connector(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
    ) -> _AutomationExecution:
        connector = self._require_connector(
            job,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        request_body = http_body_from_config(job.config)
        if connector.method == "GET":
            request_body = None
        request = build_connector_http_request(
            connector,
            secret_resolver=self._secret_resolver,
            body=request_body,
            extra_headers={
                "Content-Type": "application/json",
                "X-PlaniAdvance-Job-Id": job.id,
                "X-PlaniAdvance-Mode": "connector_snapshot_import",
            }
            if request_body is not None
            else {
                "X-PlaniAdvance-Job-Id": job.id,
                "X-PlaniAdvance-Mode": "connector_snapshot_import",
            },
        )
        response = self._send_connector_request(request)
        preview = response.body.decode("utf-8", errors="replace")[:500]
        if response.status_code < 200 or response.status_code >= 300:
            raise ValueError(
                f"Connector {connector.id!r} responded with HTTP {response.status_code}."
            )
        try:
            snapshot_payload = json.loads(response.body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Connector {connector.id!r} did not return valid JSON."
            ) from exc
        snapshot = planning_snapshot_from_json(dict(snapshot_payload))
        execution = self._import_snapshot(
            job,
            snapshot=snapshot,
            mode="connector_snapshot_import",
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        result = dict(execution.result)
        result.update(
            {
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_preview": preview,
            }
        )
        journal_details = dict(execution.journal_details)
        journal_details.update(
            {
                "connector_id": connector.id,
                "connector_name": connector.name,
                "http_status": response.status_code,
                "response_size_bytes": len(response.body),
            }
        )
        return _AutomationExecution(
            status=execution.status,
            valid=execution.valid,
            message=execution.message,
            entity_counts=execution.entity_counts,
            result=result,
            error_count=execution.error_count,
            warning_count=execution.warning_count,
            journal_details=journal_details,
        )

    def _import_snapshot(
        self,
        job: IntegrationAutomationJob,
        *,
        snapshot: CanonicalPlanningSnapshot,
        mode: str,
        organization_id: str | None,
        workspace_id: str | None,
    ) -> _AutomationExecution:
        report = validate_snapshot_report(snapshot)
        entity_counts = snapshot_entity_counts(snapshot)
        validation = report.as_dict()
        if not report.valid:
            return _AutomationExecution(
                status="blocked",
                valid=False,
                message="Inbound automation blocked by planning snapshot validation.",
                entity_counts=entity_counts,
                error_count=report.error_count,
                warning_count=report.warning_count,
                result={
                    "mode": mode,
                    "validation": validation,
                    "entity_counts": entity_counts,
                },
                journal_details={"mode": mode, "validation": validation},
            )

        imported = self._importer.execute(
            ImportPlanningSnapshotInput(
                snapshot=snapshot,
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
        )
        message = "Inbound automation imported a planning snapshot."
        return _AutomationExecution(
            status="imported",
            valid=True,
            message=message,
            entity_counts=entity_counts,
            error_count=report.error_count,
            warning_count=report.warning_count,
            result={
                "mode": mode,
                "validation": validation,
                "created": imported.created,
                "updated": imported.updated,
                "binding_count": imported.binding_count,
                "entity_counts": entity_counts,
            },
            journal_details={
                "mode": mode,
                "validation": validation,
                "created": imported.created,
                "updated": imported.updated,
                "binding_count": imported.binding_count,
            },
        )

    def _save_journal_entry(
        self,
        *,
        job: IntegrationAutomationJob,
        execution: _AutomationExecution,
        actor_details: dict[str, object],
        organization_id: str | None,
        workspace_id: str | None,
    ) -> IntegrationJournalEntry:
        details: dict[str, object] = {
            "automation_job_id": job.id,
            "automation_name": job.name,
            "trigger_type": job.trigger_type,
            "organization_id": organization_id,
            "workspace_id": workspace_id,
            "direction": job.direction,
            "message": execution.message,
            "config_summary": _config_summary(job.config),
            **execution.journal_details,
            **dict(actor_details),
        }
        entry = IntegrationJournalEntry(
            id=f"ij-{uuid4().hex[:12]}",
            action=f"automation_{job.direction}",
            source_system=job.source_system,
            status=execution.status,
            valid=execution.valid,
            organization_id=organization_id,
            workspace_id=workspace_id,
            error_count=execution.error_count,
            warning_count=execution.warning_count,
            entity_counts=execution.entity_counts,
            details=details,
        )
        self._journal.save(entry)
        return entry

    def _save_execution_record(
        self,
        *,
        job: IntegrationAutomationJob,
        execution: _AutomationExecution,
        actor_details: dict[str, object],
        organization_id: str | None,
        workspace_id: str | None,
        journal_entry: IntegrationJournalEntry,
        attempt_number: int,
        started_at: datetime,
        finished_at: datetime,
    ) -> None:
        save_integration_execution(
            self._executions,
            execution_kind="automation_run",
            target_type="automation",
            target_id=job.id,
            target_name=job.name,
            source_system=job.source_system,
            status=execution.status,
            valid=execution.valid,
            organization_id=organization_id,
            workspace_id=workspace_id,
            trigger_type=str(actor_details.get("triggered_by") or job.trigger_type),
            attempt_number=attempt_number,
            message=execution.message,
            error_code=_execution_error_code(execution),
            entity_counts=execution.entity_counts,
            details={
                "direction": job.direction,
                "config_summary": _config_summary(job.config),
                "result_summary": _automation_result_summary(execution.result),
                **execution.journal_details,
            },
            journal_entry_id=journal_entry.id,
            started_at=started_at,
            finished_at=finished_at,
            actor_details=actor_details,
        )

    def _require_connector(
        self,
        job: IntegrationAutomationJob,
        *,
        organization_id: str | None,
        workspace_id: str | None,
    ):
        if (
            self._connectors is None
            or self._secret_resolver is None
            or self._http_transport is None
        ):
            raise ValueError("Connector execution dependencies are not configured.")
        connector_id = str(job.config.get("connector_id") or "").strip()
        if not connector_id:
            raise ValueError("Connector-backed automation requires config.connector_id.")
        connector = self._connectors.get(
            connector_id,
            organization_id=organization_id,
        )
        if connector is None:
            raise ValueError(f"Integration connector {connector_id!r} was not found.")
        if not connector.is_enabled:
            raise ValueError(f"Integration connector {connector.id!r} is disabled.")
        if (
            workspace_id is not None
            and connector.workspace_id is not None
            and connector.workspace_id != workspace_id
        ):
            raise ValueError(
                f"Integration connector {connector.id!r} does not match the active workspace."
            )
        if connector.credential_id:
            if self._credentials is None:
                raise ValueError(
                    "Saved credentials are not available for connector-backed automations."
                )
            credential = self._credentials.get(
                connector.credential_id,
                organization_id=organization_id,
            )
            if credential is None:
                raise ValueError(
                    f"Integration credential {connector.credential_id!r} was not found."
                )
            connector = apply_integration_credential(
                connector=connector,
                credential=credential,
            )
        return connector

    def _send_connector_request(self, request):
        if self._http_transport is None:
            raise ValueError("Connector HTTP transport is not configured.")
        return self._http_transport.send(request)
def _automation_mode(job: IntegrationAutomationJob) -> str:
    value = job.config.get("mode")
    return str(value).strip().lower() if value is not None else ""


def _config_dict(config: dict[str, object], key: str) -> dict[str, object]:
    value = config.get(key)
    return dict(value) if isinstance(value, dict) else {}


def _config_optional_str(config: dict[str, object], key: str) -> str | None:
    value = config.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _published_plan_mode(config: dict[str, object]) -> str:
    value = str(config.get("plan_mode") or "full").strip().lower()
    return value if value in {"full", "delta"} else "full"


def _snapshot_from_config(config: dict[str, object]) -> CanonicalPlanningSnapshot:
    value = config.get("snapshot")
    if not isinstance(value, dict):
        raise ValueError("Inbound snapshot automation requires config.snapshot.")
    return planning_snapshot_from_json(dict(value))


def _csv_snapshot_from_config(config: dict[str, object]) -> CanonicalPlanningSnapshot:
    raw_bundle = config.get("csv_bundle")
    bundle = dict(raw_bundle) if isinstance(raw_bundle, dict) else dict(config)
    return snapshot_from_csv_bundle(
        CanonicalCsvBundle(
            calendars_csv=str(bundle.get("calendars_csv", "")),
            machines_csv=str(bundle.get("machines_csv", "")),
            work_orders_csv=str(bundle.get("work_orders_csv", "")),
            operations_csv=str(bundle.get("operations_csv", "")),
            source_system=str(bundle.get("source_system") or "csv"),
            exported_at=_optional_datetime(bundle.get("exported_at")),
            metadata=(
                dict(bundle.get("metadata"))
                if isinstance(bundle.get("metadata"), dict)
                else {}
            ),
        )
    )
def _optional_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _config_summary(config: dict[str, object]) -> dict[str, object]:
    sensitive = {"api_key", "token", "password", "secret", "authorization"}
    return {
        "mode": str(config.get("mode", "")),
        "configured_keys": sorted(str(key) for key in config.keys()),
        "redacted_keys": sorted(str(key) for key in config.keys() if str(key).lower() in sensitive),
    }


def _apply_base_attempt_state(
    job: IntegrationAutomationJob,
    execution: _AutomationExecution,
    now: datetime,
) -> None:
    if execution.status in {"exported", "imported", "completed"}:
        job.attempt_count = 0
        job.next_attempt_at = None
        job.last_error_code = None
        job.last_error_at = None
        return
    if execution.status == "blocked":
        job.attempt_count = 0
        job.next_attempt_at = None
        job.last_error_code = "validation_blocked"
        job.last_error_at = now
        return
    if execution.status == "failed":
        job.last_error_code = _error_code(execution.result)
        job.last_error_at = now


def _error_code(result: dict[str, object]) -> str:
    value = result.get("error_code") or result.get("error")
    if value is None or not str(value).strip():
        return "execution_failed"
    return str(value)[:64]


def _flow_result_summary(result: dict[str, object]) -> dict[str, object]:
    summary = dict(result)
    summary.pop("block_results", None)
    validation = summary.get("validation")
    if isinstance(validation, dict):
        summary["validation"] = {
            "valid": validation.get("valid"),
            "readiness_status": validation.get("readiness_status"),
            "error_count": validation.get("error_count"),
            "warning_count": validation.get("warning_count"),
        }
    return summary


def _automation_result_summary(result: dict[str, object]) -> dict[str, object]:
    summary = dict(result)
    summary.pop("snapshot", None)
    plan = summary.pop("plan", None)
    if isinstance(plan, dict):
        summary["schedule_id"] = plan.get("schedule_id")
        summary["plan_mode"] = plan.get("mode")
        summary["work_order_count"] = len(plan.get("work_orders", []))
    preview = summary.get("response_preview")
    if preview is not None:
        summary["response_preview"] = str(preview)[:200]
    if summary.get("mode") == "flow":
        summary = _flow_result_summary(summary)
    validation = summary.get("validation")
    if isinstance(validation, dict):
        summary["validation"] = {
            "valid": validation.get("valid"),
            "readiness_status": validation.get("readiness_status"),
            "error_count": validation.get("error_count"),
            "warning_count": validation.get("warning_count"),
        }
    return summary


def _execution_error_code(execution: _AutomationExecution) -> str | None:
    if execution.status in {"exported", "imported", "completed"}:
        return None
    if execution.status == "blocked":
        return "validation_blocked"
    return _error_code(execution.result)
