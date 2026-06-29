"""Dictionary-backed repository implementations for tests and demos."""

from __future__ import annotations

from datetime import datetime

from ...application.ports.audit_event_repository import AuditEvent
from ...application.ports.flow_run_trace_repository import FlowRunTrace
from ...application.ports.integration_api_client_repository import IntegrationApiClient
from ...application.ports.integration_automation_repository import IntegrationAutomationJob
from ...application.ports.integration_binding_repository import (
    IntegrationBinding,
)
from ...application.ports.integration_connector_repository import IntegrationConnector
from ...application.ports.integration_credential_repository import IntegrationCredential
from ...application.ports.integration_execution_repository import (
    IntegrationExecutionRecord,
)
from ...application.ports.integration_flow_repository import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from ...application.ports.integration_journal_repository import IntegrationJournalEntry
from ...application.ports.planning_control_repository import (
    PlanningEvent,
    PlanningWorkspaceState,
)
from ...application.ports.schedule_repository import ScheduleRunMetadata
from ...domain.entities import (
    InventoryItem,
    Machine,
    Membership,
    Organization,
    Resource,
    Schedule,
    SupplyLot,
    UserAccount,
    WorkingCalendar,
    WorkOrder,
    Workspace,
    WorkspaceAccessGrant,
)
from ..scoping import ScopedRepositoryMixin


class InMemoryWorkOrderRepository(ScopedRepositoryMixin[WorkOrder]):
    def __init__(self, seed: list[WorkOrder] | None = None) -> None:
        self._data: dict[str, WorkOrder] = {wo.id: wo for wo in (seed or [])}

    def list_all(self) -> list[WorkOrder]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[WorkOrder]:
        return [wo for wo in self._data.values() if wo.organization_id == organization_id]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkOrder]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [wo for wo in rows if wo.organization_id == organization_id]
        if workspace_id is not None:
            rows = [wo for wo in rows if wo.workspace_id == workspace_id]
        return rows

    def get(self, work_order_id: str) -> WorkOrder | None:
        return self._data.get(work_order_id)

    def add(self, work_order: WorkOrder) -> None:
        self._data[work_order.id] = work_order

    def delete(self, work_order_id: str) -> None:
        self._data.pop(work_order_id, None)


class InMemoryMachineRepository(ScopedRepositoryMixin[Machine]):
    def __init__(self, seed: list[Machine] | None = None) -> None:
        self._data: dict[str, Machine] = {m.id: m for m in (seed or [])}

    def list_all(self) -> list[Machine]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[Machine]:
        return [m for m in self._data.values() if m.organization_id == organization_id]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Machine]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [m for m in rows if m.organization_id == organization_id]
        if workspace_id is not None:
            rows = [m for m in rows if m.workspace_id == workspace_id]
        return rows

    def get(self, machine_id: str) -> Machine | None:
        return self._data.get(machine_id)

    def add(self, machine: Machine) -> None:
        self._data[machine.id] = machine

    def delete(self, machine_id: str) -> None:
        self._data.pop(machine_id, None)


class InMemoryCalendarRepository(ScopedRepositoryMixin[WorkingCalendar]):
    def __init__(self, seed: list[WorkingCalendar] | None = None) -> None:
        self._data: dict[str, WorkingCalendar] = {c.id: c for c in (seed or [])}

    def list_all(self) -> list[WorkingCalendar]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[WorkingCalendar]:
        return [c for c in self._data.values() if c.organization_id in {organization_id, None}]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkingCalendar]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [c for c in rows if c.organization_id in {organization_id, None}]
        if workspace_id is not None:
            rows = [c for c in rows if c.workspace_id in {workspace_id, None}]
        return rows

    def get(self, calendar_id: str) -> WorkingCalendar | None:
        return self._data.get(calendar_id)

    def add(self, calendar: WorkingCalendar) -> None:
        self._data[calendar.id] = calendar


class InMemoryResourceRepository(ScopedRepositoryMixin[Resource]):
    def __init__(self, seed: list[Resource] | None = None) -> None:
        self._data: dict[str, Resource] = {r.id: r for r in (seed or [])}

    def list_all(self) -> list[Resource]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[Resource]:
        return [r for r in self._data.values() if r.organization_id == organization_id]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Resource]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [r for r in rows if r.organization_id == organization_id]
        if workspace_id is not None:
            rows = [r for r in rows if r.workspace_id == workspace_id]
        return rows

    def get(self, resource_id: str) -> Resource | None:
        return self._data.get(resource_id)

    def add(self, resource: Resource) -> None:
        self._data[resource.id] = resource

    def delete(self, resource_id: str) -> None:
        self._data.pop(resource_id, None)


class InMemoryInventoryRepository(ScopedRepositoryMixin[InventoryItem]):
    def __init__(self, seed: list[InventoryItem] | None = None) -> None:
        self._data: dict[str, InventoryItem] = {item.material_id: item for item in (seed or [])}

    def list_all(self) -> list[InventoryItem]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[InventoryItem]:
        return [item for item in self._data.values() if item.organization_id == organization_id]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[InventoryItem]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [item for item in rows if item.organization_id == organization_id]
        if workspace_id is not None:
            rows = [item for item in rows if item.workspace_id == workspace_id]
        return rows

    def get(self, material_id: str) -> InventoryItem | None:
        return self._data.get(material_id)

    def add(self, item: InventoryItem) -> None:
        self._data[item.material_id] = item

    def delete(self, material_id: str) -> None:
        self._data.pop(material_id, None)


class InMemorySupplyRepository(ScopedRepositoryMixin[SupplyLot]):
    def __init__(self, seed: list[SupplyLot] | None = None) -> None:
        self._data: dict[str, SupplyLot] = {lot.id: lot for lot in (seed or [])}

    def list_all(self) -> list[SupplyLot]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[SupplyLot]:
        return [lot for lot in self._data.values() if lot.organization_id == organization_id]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[SupplyLot]:
        rows = self.list_all()
        if organization_id is not None:
            rows = [lot for lot in rows if lot.organization_id == organization_id]
        if workspace_id is not None:
            rows = [lot for lot in rows if lot.workspace_id == workspace_id]
        return rows

    def get(self, supply_id: str) -> SupplyLot | None:
        return self._data.get(supply_id)

    def add(self, lot: SupplyLot) -> None:
        self._data[lot.id] = lot

    def delete(self, supply_id: str) -> None:
        self._data.pop(supply_id, None)


class InMemoryScheduleRepository:
    def __init__(self) -> None:
        self._data: dict[str, tuple[Schedule, ScheduleRunMetadata]] = {}
        self._order: list[str] = []

    def save(
        self,
        schedule: Schedule,
        *,
        metrics: dict,
        strategy: str = "unknown",
        solver_status: str = "unknown",
        objective_value: int = 0,
        wall_time_ms: int = 0,
        diagnostics: dict | None = None,
        workspace_id: str = "default",
        scenario_name: str = "Default Scenario",
        lifecycle_status: str = "draft",
        organization_id: str | None = None,
        horizon_start: datetime | None = None,
        horizon_end: datetime | None = None,
        objective: dict | None = None,
        transfer_times: dict | None = None,
        input_snapshot: dict | None = None,
        input_snapshot_hash: str = "",
        engine_version: str = "aps-engine.v1",
    ) -> None:
        meta = ScheduleRunMetadata(
            metrics=metrics,
            strategy=strategy,
            solver_status=solver_status,
            objective_value=objective_value,
            wall_time_ms=wall_time_ms,
            diagnostics=diagnostics or {},
            workspace_id=workspace_id,
            scenario_name=scenario_name,
            lifecycle_status=lifecycle_status,
            organization_id=organization_id,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            objective=objective or {},
            transfer_times=transfer_times or {},
            input_snapshot=input_snapshot or {},
            input_snapshot_hash=input_snapshot_hash,
            engine_version=engine_version,
        )
        self._data[schedule.id] = (schedule, meta)
        if schedule.id in self._order:
            self._order.remove(schedule.id)
        self._order.append(schedule.id)

    def get(self, schedule_id: str) -> Schedule | None:
        item = self._data.get(schedule_id)
        return item[0] if item else None

    def get_metadata(self, schedule_id: str) -> ScheduleRunMetadata | None:
        item = self._data.get(schedule_id)
        return item[1] if item else None

    def delete(self, schedule_id: str) -> None:
        self._data.pop(schedule_id, None)
        if schedule_id in self._order:
            self._order.remove(schedule_id)

    def update_context(
        self,
        schedule_id: str,
        *,
        workspace_id: str | None = None,
        scenario_name: str | None = None,
        lifecycle_status: str | None = None,
    ) -> ScheduleRunMetadata | None:
        item = self._data.get(schedule_id)
        if item is None:
            return None
        schedule, meta = item
        new_meta = ScheduleRunMetadata(
            metrics=meta.metrics,
            strategy=meta.strategy,
            solver_status=meta.solver_status,
            objective_value=meta.objective_value,
            wall_time_ms=meta.wall_time_ms,
            diagnostics=meta.diagnostics,
            workspace_id=workspace_id or meta.workspace_id,
            scenario_name=scenario_name or meta.scenario_name,
            lifecycle_status=lifecycle_status or meta.lifecycle_status,
            organization_id=meta.organization_id,
            horizon_start=meta.horizon_start,
            horizon_end=meta.horizon_end,
            objective=meta.objective,
            transfer_times=meta.transfer_times,
            input_snapshot=meta.input_snapshot,
            input_snapshot_hash=meta.input_snapshot_hash,
            engine_version=meta.engine_version,
        )
        self._data[schedule_id] = (schedule, new_meta)
        return new_meta

    def list_recent(
        self,
        limit: int = 20,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        lifecycle_status: str | None = None,
    ) -> list[tuple[Schedule, ScheduleRunMetadata]]:
        ids = list(reversed(self._order))
        items = [self._data[i] for i in ids]
        if organization_id is not None:
            items = [item for item in items if item[1].organization_id == organization_id]
        if workspace_id is not None:
            items = [item for item in items if item[1].workspace_id == workspace_id]
        if lifecycle_status is not None:
            items = [item for item in items if item[1].lifecycle_status == lifecycle_status]
        return items[:limit]


class InMemoryPlanningControlRepository:
    def __init__(self) -> None:
        self._states: dict[tuple[str | None, str], PlanningWorkspaceState] = {}
        self._events: list[PlanningEvent] = []

    def get_state(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
    ) -> PlanningWorkspaceState | None:
        return self._states.get((organization_id, workspace_id))

    def save_state(
        self,
        state: PlanningWorkspaceState,
    ) -> PlanningWorkspaceState:
        self._states[(state.organization_id, state.workspace_id)] = state
        return state

    def record_event(self, event: PlanningEvent) -> PlanningEvent:
        self._events.append(event)
        return event

    def list_events(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
        limit: int = 50,
        baseline_schedule_id: str | None = None,
        candidate_schedule_id: str | None = None,
    ) -> list[PlanningEvent]:
        rows = [
            event
            for event in reversed(self._events)
            if event.organization_id == organization_id and event.workspace_id == workspace_id
        ]
        if baseline_schedule_id is not None:
            rows = [event for event in rows if event.baseline_schedule_id == baseline_schedule_id]
        if candidate_schedule_id is not None:
            rows = [event for event in rows if event.candidate_schedule_id == candidate_schedule_id]
        return rows[:limit]


class InMemoryIntegrationBindingRepository:
    def __init__(self) -> None:
        self._data: dict[tuple[str, str, str], IntegrationBinding] = {}

    def get(
        self,
        *,
        entity_type: str,
        source_system: str,
        external_ref: str,
    ) -> IntegrationBinding | None:
        return self._data.get((entity_type, source_system, external_ref))

    def save(self, binding: IntegrationBinding) -> IntegrationBinding:
        # V1.2 P0.2 — mirror the SQL repo's first-writer-wins semantics:
        # if a binding for the key already exists, keep its internal_id
        # and return it; only insert when the key is free. This keeps the
        # in-memory twin (used by unit tests + the CLI) honest about
        # what production will do under concurrent imports.
        key = (binding.entity_type, binding.source_system, binding.external_ref)
        existing = self._data.get(key)
        if existing is not None:
            return existing
        self._data[key] = binding
        return binding

    def find_external_refs(
        self,
        *,
        entity_type: str,
        source_system: str,
        internal_ids,
    ) -> dict[str, str]:
        wanted = {str(i) for i in internal_ids if i}
        if not wanted:
            return {}
        out: dict[str, str] = {}
        for binding in self._data.values():
            if binding.entity_type != entity_type:
                continue
            if binding.source_system != source_system:
                continue
            if binding.internal_id in wanted:
                out[binding.internal_id] = binding.external_ref
        return out


class InMemoryAuditEventRepository:
    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

    def save(self, event: AuditEvent) -> None:
        self._events.append(event)

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        action: str | None = None,
    ) -> list[AuditEvent]:
        events = list(reversed(self._events))
        if organization_id is not None:
            events = [event for event in events if event.organization_id == organization_id]
        if workspace_id is not None:
            events = [event for event in events if event.workspace_id == workspace_id]
        if action is not None:
            events = [event for event in events if event.action == action]
        return events[:limit]


class InMemoryFlowRunTraceRepository:
    def __init__(self) -> None:
        self._rows: list[FlowRunTrace] = []

    def save_many(self, traces: list[FlowRunTrace]) -> None:
        self._rows.extend(traces)

    def list_for_run(
        self,
        *,
        flow_id: str,
        run_id: str,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[FlowRunTrace]:
        rows = [r for r in self._rows if r.flow_id == flow_id and r.run_id == run_id]
        if organization_id is not None:
            rows = [r for r in rows if r.organization_id == organization_id]
        if workspace_id is not None:
            rows = [r for r in rows if r.workspace_id == workspace_id]
        return list(rows)


class InMemoryIntegrationJournalRepository:
    def __init__(self) -> None:
        self._entries: list[IntegrationJournalEntry] = []

    def save(self, entry: IntegrationJournalEntry) -> None:
        self._entries.append(entry)

    def list_recent(
        self,
        limit: int = 20,
        *,
        source_system: str | None = None,
        action: str | None = None,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[IntegrationJournalEntry]:
        entries = list(reversed(self._entries))
        if source_system is not None:
            entries = [entry for entry in entries if entry.source_system == source_system]
        if action is not None:
            entries = [entry for entry in entries if entry.action == action]
        if organization_id is not None:
            entries = [entry for entry in entries if entry.organization_id == organization_id]
        if workspace_id is not None:
            entries = [entry for entry in entries if entry.workspace_id == workspace_id]
        return entries[:limit]


class InMemoryIntegrationApiClientRepository(ScopedRepositoryMixin[IntegrationApiClient]):
    def __init__(self, seed: list[IntegrationApiClient] | None = None) -> None:
        self._data: dict[str, IntegrationApiClient] = {client.id: client for client in (seed or [])}

    def save(self, client: IntegrationApiClient) -> IntegrationApiClient:
        self._data[client.id] = client
        return client

    def get(
        self,
        client_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationApiClient | None:
        client = self._data.get(client_id)
        if client is None:
            return None
        if organization_id is not None and client.organization_id != organization_id:
            return None
        return client

    def find_active_by_key_hash(
        self,
        key_hash: str,
        *,
        now: datetime,
    ) -> IntegrationApiClient | None:
        for client in self._data.values():
            if client.key_hash != key_hash or not client.is_active:
                continue
            if client.expires_at is not None and client.expires_at <= now:
                continue
            return client
        return None

    def has_active_clients(
        self,
        *,
        now: datetime,
    ) -> bool:
        return any(
            client.is_active and (client.expires_at is None or client.expires_at > now)
            for client in self._data.values()
        )

    def has_clients(self) -> bool:
        return bool(self._data)

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationApiClient]:
        rows = sorted(
            self._data.values(),
            key=lambda client: client.created_at,
            reverse=True,
        )
        if organization_id is not None:
            rows = [client for client in rows if client.organization_id == organization_id]
        if workspace_id is not None:
            rows = [client for client in rows if client.workspace_id == workspace_id]
        return rows[:limit]

    def mark_used(
        self,
        client_id: str,
        *,
        used_at: datetime,
    ) -> IntegrationApiClient | None:
        client = self._data.get(client_id)
        if client is None:
            return None
        client.last_used_at = used_at
        client.updated_at = used_at
        return client


class InMemoryIntegrationConnectorRepository(ScopedRepositoryMixin[IntegrationConnector]):
    def __init__(self, seed: list[IntegrationConnector] | None = None) -> None:
        self._data: dict[str, IntegrationConnector] = {
            connector.id: connector for connector in (seed or [])
        }

    def save(self, connector: IntegrationConnector) -> IntegrationConnector:
        self._data[connector.id] = connector
        return connector

    def get(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationConnector | None:
        connector = self._data.get(connector_id)
        if connector is None:
            return None
        if organization_id is not None and connector.organization_id != organization_id:
            return None
        return connector

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationConnector]:
        rows = sorted(
            self._data.values(),
            key=lambda connector: connector.created_at,
            reverse=True,
        )
        if organization_id is not None:
            rows = [connector for connector in rows if connector.organization_id == organization_id]
        if workspace_id is not None:
            rows = [connector for connector in rows if connector.workspace_id == workspace_id]
        return rows[:limit]

    def delete(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> bool:
        existing = self._data.get(connector_id)
        if existing is None:
            return False
        if organization_id is not None and existing.organization_id != organization_id:
            return False
        del self._data[connector_id]
        return True


class InMemoryIntegrationCredentialRepository(ScopedRepositoryMixin[IntegrationCredential]):
    def __init__(self, seed: list[IntegrationCredential] | None = None) -> None:
        self._data: dict[str, IntegrationCredential] = {
            credential.id: credential for credential in (seed or [])
        }

    def save(self, credential: IntegrationCredential) -> IntegrationCredential:
        self._data[credential.id] = credential
        return credential

    def get(
        self,
        credential_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationCredential | None:
        credential = self._data.get(credential_id)
        if credential is None:
            return None
        if organization_id is not None and credential.organization_id != organization_id:
            return None
        return credential

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationCredential]:
        rows = sorted(
            self._data.values(),
            key=lambda credential: credential.created_at,
            reverse=True,
        )
        if organization_id is not None:
            rows = [
                credential for credential in rows if credential.organization_id == organization_id
            ]
        if workspace_id is not None:
            rows = [credential for credential in rows if credential.workspace_id == workspace_id]
        return rows[:limit]


class InMemoryIntegrationExecutionRepository:
    def __init__(self, seed: list[IntegrationExecutionRecord] | None = None) -> None:
        self._records: list[IntegrationExecutionRecord] = list(seed or [])

    def save(
        self,
        record: IntegrationExecutionRecord,
    ) -> IntegrationExecutionRecord:
        self._records.append(record)
        return record

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        execution_kind: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        source_system: str | None = None,
        status: str | None = None,
    ) -> list[IntegrationExecutionRecord]:
        rows = list(
            sorted(
                self._records,
                key=lambda record: record.started_at,
                reverse=True,
            )
        )
        if organization_id is not None:
            rows = [record for record in rows if record.organization_id == organization_id]
        if workspace_id is not None:
            rows = [record for record in rows if record.workspace_id == workspace_id]
        if execution_kind is not None:
            rows = [record for record in rows if record.execution_kind == execution_kind]
        if target_type is not None:
            rows = [record for record in rows if record.target_type == target_type]
        if target_id is not None:
            rows = [record for record in rows if record.target_id == target_id]
        if source_system is not None:
            rows = [record for record in rows if record.source_system == source_system]
        if status is not None:
            rows = [record for record in rows if record.status == status]
        return rows[:limit]


class InMemoryIntegrationFlowRepository(ScopedRepositoryMixin[IntegrationFlow]):
    def __init__(self, seed: list[IntegrationFlow] | None = None) -> None:
        self._data: dict[str, IntegrationFlow] = {flow.id: flow for flow in (seed or [])}

    def save(self, flow: IntegrationFlow) -> IntegrationFlow:
        self._data[flow.id] = IntegrationFlow(
            id=flow.id,
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            name=flow.name,
            source_system=flow.source_system,
            is_enabled=flow.is_enabled,
            blocks=[
                IntegrationFlowBlock(
                    id=block.id,
                    block_type=block.block_type,
                    name=block.name,
                    input_block_id=block.input_block_id,
                    inputs=list(block.inputs),
                    config=dict(block.config),
                )
                for block in flow.blocks
            ],
            last_status=flow.last_status,
            last_message=flow.last_message,
            last_run_at=flow.last_run_at,
            created_by_user_id=flow.created_by_user_id,
            created_at=flow.created_at,
            updated_at=flow.updated_at,
        )
        return self._data[flow.id]

    def get(
        self,
        flow_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationFlow | None:
        flow = self._data.get(flow_id)
        if flow is None:
            return None
        if organization_id is not None and flow.organization_id != organization_id:
            return None
        return self.save(flow)

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationFlow]:
        rows = sorted(
            self._data.values(),
            key=lambda flow: flow.created_at,
            reverse=True,
        )
        if organization_id is not None:
            rows = [flow for flow in rows if flow.organization_id == organization_id]
        if workspace_id is not None:
            rows = [flow for flow in rows if flow.workspace_id == workspace_id]
        return [self.save(flow) for flow in rows[:limit]]

    def find_by_webhook_token(
        self, token: str
    ) -> tuple[IntegrationFlow, IntegrationFlowBlock] | None:
        from ...application.use_cases.webhook_token import webhook_token_for

        for flow in self._data.values():
            for block in flow.blocks:
                if block.block_type != "trigger_webhook":
                    continue
                if webhook_token_for(flow_id=flow.id, block_id=block.id) == token:
                    # Return a defensive copy via save() so callers
                    # can't mutate the stored block.config (mirrors
                    # the get() contract above).
                    saved = self.save(flow)
                    matching = next(
                        b for b in saved.blocks if b.id == block.id
                    )
                    return saved, matching
        return None


class InMemoryIntegrationAutomationRepository(ScopedRepositoryMixin[IntegrationAutomationJob]):
    def __init__(self, seed: list[IntegrationAutomationJob] | None = None) -> None:
        self._data: dict[str, IntegrationAutomationJob] = {job.id: job for job in (seed or [])}

    def save(self, job: IntegrationAutomationJob) -> IntegrationAutomationJob:
        self._data[job.id] = job
        return job

    def get(
        self,
        job_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        job = self._data.get(job_id)
        if job is None:
            return None
        if organization_id is not None and job.organization_id != organization_id:
            return None
        return job

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationAutomationJob]:
        rows = sorted(
            self._data.values(),
            key=lambda job: job.created_at,
            reverse=True,
        )
        if organization_id is not None:
            rows = [job for job in rows if job.organization_id == organization_id]
        if workspace_id is not None:
            rows = [job for job in rows if job.workspace_id == workspace_id]
        return rows[:limit]

    def try_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        locked_until,
        now,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        job = self.get(job_id, organization_id=organization_id)
        if job is None:
            return None
        if job.locked_until is not None and job.locked_until > now:
            return None
        job.lock_owner = owner_id
        job.locked_until = locked_until
        job.updated_at = now
        return job

    def release_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        now,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        job = self.get(job_id, organization_id=organization_id)
        if job is None or job.lock_owner != owner_id:
            return None
        job.lock_owner = None
        job.locked_until = None
        job.updated_at = now
        return job


class InMemoryOrganizationRepository:
    def __init__(self, seed: list[Organization] | None = None) -> None:
        self._data: dict[str, Organization] = {org.id: org for org in (seed or [])}

    def list_all(self) -> list[Organization]:
        return list(self._data.values())

    def get(self, organization_id: str) -> Organization | None:
        return self._data.get(organization_id)

    def get_by_slug(self, slug: str) -> Organization | None:
        return next((org for org in self._data.values() if org.slug == slug), None)

    def add(self, organization: Organization) -> None:
        self._data[organization.id] = organization


class InMemoryUserAccountRepository:
    def __init__(self, seed: list[UserAccount] | None = None) -> None:
        self._data: dict[str, UserAccount] = {user.id: user for user in (seed or [])}

    def list_all(self) -> list[UserAccount]:
        return list(self._data.values())

    def get(self, user_id: str) -> UserAccount | None:
        return self._data.get(user_id)

    def get_by_email(self, email: str) -> UserAccount | None:
        return next(
            (user for user in self._data.values() if user.email == email.lower()),
            None,
        )

    def add(self, user: UserAccount) -> None:
        self._data[user.id] = user


class InMemoryMembershipRepository:
    def __init__(self, seed: list[Membership] | None = None) -> None:
        self._data: dict[tuple[str, str], Membership] = {
            (membership.organization_id, membership.user_id): membership
            for membership in (seed or [])
        }

    def list_for_organization(self, organization_id: str) -> list[Membership]:
        return [
            membership
            for membership in self._data.values()
            if membership.organization_id == organization_id
        ]

    def list_for_user(self, user_id: str) -> list[Membership]:
        return [membership for membership in self._data.values() if membership.user_id == user_id]

    def get(self, organization_id: str, user_id: str) -> Membership | None:
        return self._data.get((organization_id, user_id))

    def add(self, membership: Membership) -> None:
        self._data[(membership.organization_id, membership.user_id)] = membership


class InMemoryWorkspaceRepository:
    def __init__(self, seed: list[Workspace] | None = None) -> None:
        default_seed = seed or [
            Workspace(
                id="default",
                name="Default Workspace",
                description="Default planning workspace",
                organization_id=None,
                is_default=True,
                is_active=True,
            )
        ]
        self._data: dict[str, Workspace] = {workspace.id: workspace for workspace in default_seed}

    def list_all(self) -> list[Workspace]:
        return list(self._data.values())

    def list_for_organization(self, organization_id: str) -> list[Workspace]:
        return [
            workspace
            for workspace in self._data.values()
            if workspace.organization_id == organization_id
        ]

    def get(self, workspace_id: str) -> Workspace | None:
        return self._data.get(workspace_id)

    def add(self, workspace: Workspace) -> None:
        self._data[workspace.id] = workspace


class InMemoryWorkspaceAccessGrantRepository:
    def __init__(self, seed: list[WorkspaceAccessGrant] | None = None) -> None:
        self._data: dict[tuple[str, str], WorkspaceAccessGrant] = {
            (grant.workspace_id, grant.user_id): grant for grant in (seed or [])
        }

    def list_for_organization(self, organization_id: str) -> list[WorkspaceAccessGrant]:
        return [grant for grant in self._data.values() if grant.organization_id == organization_id]

    def list_for_workspace(self, workspace_id: str) -> list[WorkspaceAccessGrant]:
        return [grant for grant in self._data.values() if grant.workspace_id == workspace_id]

    def list_for_user(
        self,
        user_id: str,
        *,
        organization_id: str | None = None,
    ) -> list[WorkspaceAccessGrant]:
        rows = [grant for grant in self._data.values() if grant.user_id == user_id]
        if organization_id is not None:
            rows = [grant for grant in rows if grant.organization_id == organization_id]
        return rows

    def get(self, workspace_id: str, user_id: str) -> WorkspaceAccessGrant | None:
        return self._data.get((workspace_id, user_id))

    def add(self, grant: WorkspaceAccessGrant) -> None:
        self._data[(grant.workspace_id, grant.user_id)] = grant

    def delete(self, workspace_id: str, user_id: str) -> None:
        self._data.pop((workspace_id, user_id), None)


class InMemoryRevokedAuthTokenRepository:
    """In-memory revocation list — twin of SqlRevokedAuthTokenRepository.

    Used by unit tests and the in-memory CLI mode. Lost on process
    restart, which is acceptable for tests (no persistence contract)
    and for a CLI flow that never issues planner tokens.
    """

    def __init__(self) -> None:
        self._entries: dict[str, tuple[datetime, datetime]] = {}

    def is_revoked(self, token_hash: str) -> bool:
        return token_hash in self._entries

    def revoke(
        self,
        token_hash: str,
        *,
        expires_at: datetime,
        revoked_at: datetime,
    ) -> None:
        self._entries.setdefault(token_hash, (expires_at, revoked_at))

    def purge_expired(self, *, now: datetime) -> int:
        stale = [
            token_hash
            for token_hash, (expires_at, _) in self._entries.items()
            if expires_at <= now
        ]
        for token_hash in stale:
            del self._entries[token_hash]
        return len(stale)


class InMemoryWebhookEventDedupRepository:
    """In-memory twin of :class:`SqlWebhookEventDedupRepository`.

    First-writer wins for a (token, idempotency_key) pair; subsequent
    records with the same key are no-ops. Used by unit tests + the
    in-memory dev CLI (no persistence contract — lost on restart,
    which is the expected behaviour for a tests-only adapter)."""

    def __init__(self) -> None:
        from ...application.ports.webhook_event_dedup_repository import (
            WebhookEventRecord,
        )

        self._record_cls = WebhookEventRecord
        self._entries: dict[tuple[str, str], WebhookEventRecord] = {}

    def find(self, *, token: str, idempotency_key: str):
        return self._entries.get((token, idempotency_key))

    def record(
        self,
        *,
        token: str,
        idempotency_key: str,
        body_hash: str,
        run_id: str | None,
        status: str,
        recorded_at: datetime,
    ) -> None:
        key = (token, idempotency_key)
        if key in self._entries:
            return
        self._entries[key] = self._record_cls(
            token=token,
            idempotency_key=idempotency_key,
            body_hash=body_hash,
            run_id=run_id,
            status=status,
            recorded_at=recorded_at,
        )

    def purge_expired(self, *, now: datetime, max_age_hours: int) -> int:
        from datetime import timedelta

        threshold = now - timedelta(hours=max_age_hours)
        stale = [
            key
            for key, record in self._entries.items()
            if record.recorded_at <= threshold
        ]
        for key in stale:
            del self._entries[key]
        return len(stale)


class InMemoryUserSessionRevocationRepository:
    """In-memory user-keyed revocation cutoff — twin of
    :class:`SqlUserSessionRevocationRepository`.

    Used by unit tests and the in-memory CLI mode. Monotone (a
    later cutoff replaces an earlier one; an earlier cutoff is a no-op).
    """

    def __init__(self) -> None:
        self._entries: dict[str, tuple[datetime, datetime]] = {}

    def get_revoked_before(self, user_id: str) -> datetime | None:
        entry = self._entries.get(user_id)
        return entry[0] if entry is not None else None

    def revoke_user_sessions(
        self,
        user_id: str,
        *,
        revoked_before_iat: datetime,
        revoked_at: datetime,
    ) -> None:
        existing = self._entries.get(user_id)
        if existing is None or existing[0] < revoked_before_iat:
            self._entries[user_id] = (revoked_before_iat, revoked_at)

    def purge_obsolete(
        self,
        *,
        now: datetime,
        max_session_age: int,
    ) -> int:
        from datetime import timedelta

        threshold = now - timedelta(hours=max_session_age)
        stale = [
            user_id
            for user_id, (revoked_before_iat, _) in self._entries.items()
            if revoked_before_iat <= threshold
        ]
        for user_id in stale:
            del self._entries[user_id]
        return len(stale)
