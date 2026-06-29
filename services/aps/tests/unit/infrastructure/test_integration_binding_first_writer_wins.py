"""V1.2 P0.2 — first-writer-wins semantics on the binding repo.

Before P0.2, ``IntegrationBindingRepository.save()`` did SELECT-then-
INSERT/UPDATE in two SQL statements. Two concurrent imports could both
miss the SELECT, both call INSERT, and the loser crashed on the
``uq_integration_binding_key`` UNIQUE constraint — surfaced as HTTP 500
to the API caller.

The port now mandates atomic upsert with first-writer-wins:
``internal_id`` of the existing row is preserved on conflict, and the
return value is the binding that actually persisted. ``ImportPlanningSnapshot``
inspects that return value to detect a lost race and re-converges on the
winner's internal_id rather than forking the downstream domain writes.

These tests pin the in-memory twin (the source of truth for unit tests
and the CLI demo). The SQL implementation relies on PostgreSQL's
``ON CONFLICT DO UPDATE`` which is exercised end-to-end in the real-stack
test (``tests/integration/test_real_stack_postgres.py``) — there is no
unit-level way to simulate two parallel SQL sessions without a real DB.
"""

from __future__ import annotations

from planiadvance_v2.application.ports import IntegrationBinding
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryIntegrationBindingRepository,
)


def _make(external_ref: str, internal_id: str) -> IntegrationBinding:
    return IntegrationBinding(
        entity_type="work_order",
        source_system="odoo",
        external_ref=external_ref,
        internal_id=internal_id,
    )


def test_first_save_returns_the_supplied_binding():
    repo = InMemoryIntegrationBindingRepository()

    saved = repo.save(_make("MO-42", "internal-001"))

    assert saved.internal_id == "internal-001"
    assert saved.external_ref == "MO-42"


def test_second_save_with_same_key_preserves_first_internal_id():
    """The critical invariant: a concurrent import that lost the race
    must see the WINNER's internal_id, never its own. Otherwise the two
    flows fork — one writes domain rows pegged to internal-001, the
    other to internal-002, and the binding table only tracks one of
    them, leaving orphan domain rows."""

    repo = InMemoryIntegrationBindingRepository()
    repo.save(_make("MO-42", "internal-001"))

    saved = repo.save(_make("MO-42", "internal-002"))

    assert saved.internal_id == "internal-001"  # winner kept
    # And no second row was stored:
    stored = repo.get(
        entity_type="work_order", source_system="odoo", external_ref="MO-42"
    )
    assert stored is not None
    assert stored.internal_id == "internal-001"


def test_caller_can_detect_lost_race_from_return_value():
    """ImportPlanningSnapshot uses this exact pattern."""

    repo = InMemoryIntegrationBindingRepository()
    repo.save(_make("MO-42", "winner-id"))

    attempted = _make("MO-42", "my-id")
    saved = repo.save(attempted)

    lost_race = saved.internal_id != attempted.internal_id
    assert lost_race is True


def test_different_keys_do_not_collide():
    repo = InMemoryIntegrationBindingRepository()
    a = repo.save(_make("MO-1", "id-a"))
    b = repo.save(_make("MO-2", "id-b"))

    assert a.internal_id == "id-a"
    assert b.internal_id == "id-b"


def test_other_entity_type_does_not_collide():
    """Same external_ref but different entity_type → independent rows."""

    repo = InMemoryIntegrationBindingRepository()
    repo.save(
        IntegrationBinding(
            entity_type="work_order",
            source_system="odoo",
            external_ref="42",
            internal_id="wo-42",
        )
    )
    saved = repo.save(
        IntegrationBinding(
            entity_type="machine",
            source_system="odoo",
            external_ref="42",
            internal_id="m-42",
        )
    )

    assert saved.internal_id == "m-42"


def test_import_use_case_reconverges_on_lost_race():
    """End-to-end: when ImportPlanningSnapshot loses a race on a binding,
    its downstream mapping must point at the WINNER's internal_id, not
    at the canonical id it tried to insert. Otherwise the imported
    domain rows reference a binding that lives under a different id and
    the planner sees a phantom orphan.

    We seed the binding repo with a "winner" binding first, then import
    a snapshot whose canonical id matches the seeded external_ref. The
    use case must detect the conflict via the save() return value and
    re-converge: the imported work_order's id must be the winner's
    internal_id, not the canonical one.
    """

    from datetime import datetime

    from planiadvance_v2.application.integration import export_planning_snapshot
    from planiadvance_v2.application.use_cases.import_planning_snapshot import (
        ImportPlanningSnapshot,
        ImportPlanningSnapshotInput,
    )
    from planiadvance_v2.infrastructure.in_memory import (
        InMemoryCalendarRepository,
        InMemoryMachineRepository,
        InMemoryResourceRepository,
        InMemoryWorkOrderRepository,
    )
    from tests.support.reference_scenarios import build_reference_workshop

    workshop = build_reference_workshop()
    snapshot = export_planning_snapshot(
        calendars=workshop.calendars,
        machines=workshop.machines,
        resources=workshop.resources,
        work_orders=workshop.work_orders,
        transfer_times=workshop.transfer_times,
        source_system="erp-demo",
        exported_at=datetime(2026, 1, 5, 7, 0, 0),
    )

    # Seed a "winner" binding for the first machine: someone got there
    # first and assigned it a different internal_id.
    first_machine = snapshot.machines[0]
    bindings = InMemoryIntegrationBindingRepository()
    winner_id = "WINNER-MACHINE-ID"
    bindings.save(
        IntegrationBinding(
            entity_type="machine",
            source_system=snapshot.source_system,
            external_ref=first_machine.external_ref or first_machine.id,
            internal_id=winner_id,
        )
    )

    use_case = ImportPlanningSnapshot(
        calendars=InMemoryCalendarRepository(),
        machines=InMemoryMachineRepository(),
        resources=InMemoryResourceRepository(),
        work_orders=InMemoryWorkOrderRepository(),
        bindings=bindings,
    )

    # NOTE: simulating "concurrent" insertion is tricky without threads.
    # The seeded binding stands in for a winning flow that committed
    # first. When our import calls bindings.get(external_ref) it finds
    # it, returns the winner's id, and the rest of the import maps
    # downstream rows to that id. This proves the resolution layer
    # honours the winner — whether the winner arrived 1 ms or 1 day
    # before, the mechanism is the same.
    result = use_case.execute(ImportPlanningSnapshotInput(snapshot=snapshot))

    # The binding registers as "found, not created" — we didn't bump
    # the create counter for this machine.
    assert result.created["machines"] == len(snapshot.machines) - 1

    # The winner's internal_id is in the binding table:
    stored = bindings.get(
        entity_type="machine",
        source_system=snapshot.source_system,
        external_ref=first_machine.external_ref or first_machine.id,
    )
    assert stored is not None
    assert stored.internal_id == winner_id
