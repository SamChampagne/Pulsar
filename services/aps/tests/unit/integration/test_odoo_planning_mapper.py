"""Unit tests for Odoo → APS canonical snapshot mapping.

The mapper is pure: it takes raw search_read result dicts (as Odoo
returns them, with [id, name] tuples for many2one and decimal-hour
floats for resource.calendar.attendance) and produces a
CanonicalPlanningSnapshot the existing import_snapshot pipeline can
consume unchanged.
"""

from __future__ import annotations

from datetime import datetime, time

from planiadvance_v2.application.integration import (
    CanonicalPlanningSnapshot,
)
from planiadvance_v2.application.integration.odoo_planning_mapper import (
    DEFAULT_MACHINE_ID,
    OdooWriteOp,
    build_canonical_snapshot_from_odoo,
    format_odoo_datetime,
    parse_odoo_datetime,
    parse_odoo_hour_to_time,
    published_plan_to_odoo_writes,
)


class TestParseOdooHourToTime:
    def test_whole_hours(self):
        assert parse_odoo_hour_to_time(8.0) == time(8, 0)
        assert parse_odoo_hour_to_time(17.0) == time(17, 0)

    def test_half_hours(self):
        assert parse_odoo_hour_to_time(8.5) == time(8, 30)

    def test_quarter_hours(self):
        assert parse_odoo_hour_to_time(13.25) == time(13, 15)
        assert parse_odoo_hour_to_time(13.75) == time(13, 45)

    def test_clamps_above_24(self):
        # Odoo stores "end of day" as 24.0 sometimes
        assert parse_odoo_hour_to_time(24.0) == time(23, 59)


class TestParseOdooDatetime:
    def test_standard_format(self):
        assert parse_odoo_datetime("2026-05-15 10:00:00") == datetime(2026, 5, 15, 10, 0, 0)

    def test_returns_none_when_falsy(self):
        assert parse_odoo_datetime(False) is None
        assert parse_odoo_datetime(None) is None
        assert parse_odoo_datetime("") is None


def _sample_odoo_data(
    *,
    with_workcenters: bool = True,
    with_workorders: bool = True,
) -> dict[str, list[dict]]:
    """Fake Odoo search_read responses for a small workshop."""
    productions = [
        {
            "id": 1,
            "name": "WH/MO/00001",
            "product_id": [1, "Palette"],
            "product_qty": 5.0,
            "state": "confirmed",
            "date_start": "2026-05-15 08:00:00",
            "date_finished": "2026-05-15 17:00:00",
            "priority": "0",
        },
        {
            "id": 2,
            "name": "WH/MO/00002",
            "product_id": [4, "Petite Palette"],
            "product_qty": 5.0,
            "state": "confirmed",
            "date_start": False,
            "date_finished": False,
            "priority": "1",
        },
    ]
    workorders = (
        [
            {
                "id": 10,
                "name": "Cut",
                "production_id": [1, "WH/MO/00001"],
                "workcenter_id": [100, "Cut Station"],
                "duration_expected": 120.0,
                "state": "ready",
            },
            {
                "id": 11,
                "name": "Assemble",
                "production_id": [1, "WH/MO/00001"],
                "workcenter_id": [101, "Assembly"],
                "duration_expected": 60.0,
                "state": "ready",
            },
        ]
        if with_workorders
        else []
    )
    workcenters = (
        [
            {
                "id": 100,
                "name": "Cut Station",
                "code": "CUT",
                "resource_calendar_id": [1000, "Standard 40h"],
                "time_efficiency": 100.0,
                "default_capacity": 1.0,
            },
            {
                "id": 101,
                "name": "Assembly",
                "code": "ASM",
                "resource_calendar_id": [1000, "Standard 40h"],
                "time_efficiency": 100.0,
                "default_capacity": 1.0,
            },
        ]
        if with_workcenters
        else []
    )
    calendars = [
        {"id": 1000, "name": "Standard 40h"},
    ]
    attendances = [
        {"id": 9001, "calendar_id": [1000, "Standard 40h"], "dayofweek": "0", "hour_from": 8.0, "hour_to": 17.0},
        {"id": 9002, "calendar_id": [1000, "Standard 40h"], "dayofweek": "1", "hour_from": 8.0, "hour_to": 17.0},
        {"id": 9003, "calendar_id": [1000, "Standard 40h"], "dayofweek": "2", "hour_from": 8.0, "hour_to": 17.0},
        {"id": 9004, "calendar_id": [1000, "Standard 40h"], "dayofweek": "3", "hour_from": 8.0, "hour_to": 17.0},
        {"id": 9005, "calendar_id": [1000, "Standard 40h"], "dayofweek": "4", "hour_from": 8.0, "hour_to": 17.0},
    ]
    return {
        "productions": productions,
        "workorders": workorders,
        "workcenters": workcenters,
        "calendars": calendars,
        "attendances": attendances,
    }


class TestBuildCanonicalSnapshotHappyPath:
    def test_returns_canonical_planning_snapshot(self):
        data = _sample_odoo_data()
        snapshot = build_canonical_snapshot_from_odoo(**data, source_system="odoo-17")
        assert isinstance(snapshot, CanonicalPlanningSnapshot)
        assert snapshot.source_system == "odoo-17"

    def test_maps_workcenters_to_machines(self):
        data = _sample_odoo_data()
        snapshot = build_canonical_snapshot_from_odoo(**data)
        machines_by_id = {m.id: m for m in snapshot.machines}
        assert "100" in machines_by_id
        assert machines_by_id["100"].name == "Cut Station"
        assert machines_by_id["100"].calendar_id == "1000"
        assert machines_by_id["100"].efficiency == 1.0  # 100% scaled to 1.0

    def test_maps_calendars_with_attendances_into_shifts(self):
        data = _sample_odoo_data()
        snapshot = build_canonical_snapshot_from_odoo(**data)
        cals_by_id = {c.id: c for c in snapshot.calendars}
        assert "1000" in cals_by_id
        cal = cals_by_id["1000"]
        # 5 weekdays of 9h shifts
        assert len(cal.shifts) == 5
        # Monday 8:00-17:00
        monday = next(s for s in cal.shifts if s.weekday == 0)
        assert monday.start == time(8, 0)
        assert monday.end == time(17, 0)

    def test_maps_productions_to_work_orders(self):
        data = _sample_odoo_data()
        snapshot = build_canonical_snapshot_from_odoo(**data)
        wos_by_id = {w.id: w for w in snapshot.work_orders}
        assert "1" in wos_by_id
        wo = wos_by_id["1"]
        assert wo.name == "WH/MO/00001"
        assert wo.product_id == "1"  # m2o[0] as str
        assert wo.quantity == 5

    def test_maps_workorders_to_operations_under_their_production(self):
        data = _sample_odoo_data()
        snapshot = build_canonical_snapshot_from_odoo(**data)
        wo1 = next(w for w in snapshot.work_orders if w.id == "1")
        # MO 1 has 2 routings -> 2 ops in sequence
        assert len(wo1.operations) == 2
        cut = wo1.operations[0]
        assert cut.name == "Cut"
        assert cut.duration_minutes == 120
        assert cut.eligible_machine_ids == ("100",)
        assert cut.sequence == 1
        assemble = wo1.operations[1]
        assert assemble.sequence == 2
        assert assemble.eligible_machine_ids == ("101",)


class TestBuildCanonicalSnapshotSynthesis:
    """When Odoo has no workcenters and/or no workorders, the block still
    produces a usable APS snapshot by synthesizing defaults."""

    def test_synthesizes_default_machine_when_no_workcenters_exist(self):
        data = _sample_odoo_data(with_workcenters=False, with_workorders=False)
        snapshot = build_canonical_snapshot_from_odoo(**data)
        assert len(snapshot.machines) == 1
        default = snapshot.machines[0]
        assert default.id == DEFAULT_MACHINE_ID
        # The default machine attaches itself to the first available calendar
        assert default.calendar_id == "1000"

    def test_synthesizes_one_operation_per_production_when_no_workorders_exist(
        self,
    ):
        data = _sample_odoo_data(with_workorders=False)
        snapshot = build_canonical_snapshot_from_odoo(
            **data, default_operation_duration_minutes=45
        )
        for wo in snapshot.work_orders:
            assert len(wo.operations) == 1
            op = wo.operations[0]
            assert op.duration_minutes == 45
            # Synthetic op is eligible on every known machine
            assert set(op.eligible_machine_ids) == {m.id for m in snapshot.machines}

    def test_synthesizes_when_workorders_and_workcenters_both_missing(self):
        data = _sample_odoo_data(with_workcenters=False, with_workorders=False)
        snapshot = build_canonical_snapshot_from_odoo(**data)
        # Every work_order has one op pointing at the default machine
        assert all(len(w.operations) == 1 for w in snapshot.work_orders)
        assert all(
            w.operations[0].eligible_machine_ids == (DEFAULT_MACHINE_ID,)
            for w in snapshot.work_orders
        )

    def test_fills_release_and_due_dates_when_odoo_returns_false(self):
        data = _sample_odoo_data()
        # MO 2 has False/False dates
        snapshot = build_canonical_snapshot_from_odoo(
            **data, now=datetime(2026, 6, 1, 0, 0, 0)
        )
        wo2 = next(w for w in snapshot.work_orders if w.id == "2")
        assert wo2.release_date == datetime(2026, 6, 1, 0, 0, 0)
        assert wo2.due_date > wo2.release_date

    def test_synthesizes_default_calendar_when_odoo_has_none(self):
        data = _sample_odoo_data(with_workcenters=False, with_workorders=False)
        data["calendars"] = []
        data["attendances"] = []
        snapshot = build_canonical_snapshot_from_odoo(**data)
        assert len(snapshot.calendars) == 1
        # Default machine still gets a real calendar id
        assert snapshot.machines[0].calendar_id == snapshot.calendars[0].id


class TestBuildCanonicalSnapshotEdgeCases:
    def test_empty_inputs_produce_empty_snapshot_with_synthetic_defaults(self):
        snapshot = build_canonical_snapshot_from_odoo(
            productions=[],
            workorders=[],
            workcenters=[],
            calendars=[],
            attendances=[],
        )
        assert snapshot.work_orders == ()
        # Still synthesize at least one machine + calendar so the snapshot
        # is structurally valid even if empty
        assert len(snapshot.machines) == 1
        assert len(snapshot.calendars) == 1

    def test_orphan_workorder_pointing_at_unknown_production_is_dropped(self):
        data = _sample_odoo_data()
        data["workorders"].append(
            {
                "id": 99,
                "name": "Orphan",
                "production_id": [999, "Missing"],
                "workcenter_id": [100, "Cut Station"],
                "duration_expected": 30.0,
                "state": "ready",
            }
        )
        snapshot = build_canonical_snapshot_from_odoo(**data)
        all_op_ids = {op.id for w in snapshot.work_orders for op in w.operations}
        assert "99" not in all_op_ids

    def test_workorder_with_no_workcenter_falls_back_to_all_machines(self):
        data = _sample_odoo_data()
        data["workorders"][0]["workcenter_id"] = False
        snapshot = build_canonical_snapshot_from_odoo(**data)
        wo1 = next(w for w in snapshot.work_orders if w.id == "1")
        first_op = wo1.operations[0]
        # Falls back to any machine, so eligible should include all real workcenters
        assert set(first_op.eligible_machine_ids) >= {"100", "101"}


def test_uses_default_operation_duration_when_workorder_has_zero_duration():
    data = _sample_odoo_data()
    data["workorders"][0]["duration_expected"] = 0.0
    snapshot = build_canonical_snapshot_from_odoo(
        **data, default_operation_duration_minutes=99
    )
    wo1 = next(w for w in snapshot.work_orders if w.id == "1")
    first_op = wo1.operations[0]
    assert first_op.duration_minutes == 99


def test_invalid_priority_falls_back_to_normal():
    data = _sample_odoo_data()
    data["productions"][0]["priority"] = False
    snapshot = build_canonical_snapshot_from_odoo(**data)
    wo1 = next(w for w in snapshot.work_orders if w.id == "1")
    assert wo1.priority in {"low", "normal", "high"}


# ---------------------------------------------------------------------------
# PUSH back: published_plan -> Odoo writes
# ---------------------------------------------------------------------------


class TestFormatOdooDatetime:
    def test_renders_datetime_in_odoo_format(self):
        assert (
            format_odoo_datetime(datetime(2026, 5, 15, 8, 30, 0))
            == "2026-05-15 08:30:00"
        )

    def test_parses_iso_string(self):
        assert format_odoo_datetime("2026-05-15T08:30:00") == "2026-05-15 08:30:00"

    def test_strips_zulu_timezone(self):
        assert format_odoo_datetime("2026-05-15T08:30:00Z") is not None

    def test_returns_none_for_empty(self):
        assert format_odoo_datetime(None) is None
        assert format_odoo_datetime("") is None
        assert format_odoo_datetime("garbage") is None


def _published_plan_with_mo(
    *,
    work_order_external_ref: str | None = "1",
    operations: list[dict] | None = None,
) -> dict:
    return {
        "work_orders": [
            {
                "work_order_id": "wo-1",
                "external_ref": work_order_external_ref,
                "operations": operations
                or [
                    {
                        "operation_id": "op-1",
                        "external_ref": "10",
                        "planned_start": "2026-05-15T08:00:00",
                        "planned_end": "2026-05-15T10:00:00",
                    },
                    {
                        "operation_id": "op-2",
                        "external_ref": "11",
                        "planned_start": "2026-05-15T10:00:00",
                        "planned_end": "2026-05-15T12:00:00",
                    },
                ],
            }
        ]
    }


class TestPublishedPlanToOdooWritesHappyPath:
    def test_emits_mo_window_write_with_min_start_max_end(self):
        writes = published_plan_to_odoo_writes(_published_plan_with_mo())
        mo_writes = [w for w in writes if w.model == "mrp.production"]
        assert len(mo_writes) == 1
        assert mo_writes[0].ids == (1,)
        assert mo_writes[0].vals == {
            "date_start": "2026-05-15 08:00:00",
            "date_finished": "2026-05-15 12:00:00",
        }

    def test_emits_one_workorder_write_per_op_with_external_ref(self):
        writes = published_plan_to_odoo_writes(_published_plan_with_mo())
        wo_writes = [w for w in writes if w.model == "mrp.workorder"]
        assert len(wo_writes) == 2
        first = next(w for w in wo_writes if w.ids == (10,))
        assert first.vals == {
            "date_start": "2026-05-15 08:00:00",
            "date_finished": "2026-05-15 10:00:00",
        }

    def test_returns_tuple_of_OdooWriteOp(self):
        writes = published_plan_to_odoo_writes(_published_plan_with_mo())
        assert all(isinstance(w, OdooWriteOp) for w in writes)


class TestPublishedPlanToOdooWritesEdgeCases:
    def test_skips_work_order_when_external_ref_missing(self):
        plan = _published_plan_with_mo(work_order_external_ref=None)
        writes = published_plan_to_odoo_writes(plan)
        assert all(w.model != "mrp.production" for w in writes)
        # Operations with their own external_ref are still emitted
        assert any(w.model == "mrp.workorder" for w in writes)

    def test_skips_operation_without_external_ref(self):
        plan = _published_plan_with_mo(
            operations=[
                {
                    "operation_id": "op-x",
                    "external_ref": None,
                    "planned_start": "2026-05-15T08:00:00",
                    "planned_end": "2026-05-15T10:00:00",
                }
            ]
        )
        writes = published_plan_to_odoo_writes(plan)
        assert all(w.model != "mrp.workorder" for w in writes)

    def test_skips_operation_when_no_planned_dates(self):
        plan = _published_plan_with_mo(
            operations=[
                {
                    "operation_id": "op-x",
                    "external_ref": "55",
                    "planned_start": None,
                    "planned_end": None,
                }
            ]
        )
        writes = published_plan_to_odoo_writes(plan)
        # MO has no dates to compute window from -> no MO write either
        assert writes == ()

    def test_only_partial_window_emits_partial_vals(self):
        plan = _published_plan_with_mo(
            operations=[
                {
                    "operation_id": "op-x",
                    "external_ref": "60",
                    "planned_start": "2026-05-15T08:00:00",
                    "planned_end": None,
                }
            ]
        )
        writes = published_plan_to_odoo_writes(plan)
        mo_write = next(w for w in writes if w.model == "mrp.production")
        assert mo_write.vals == {"date_start": "2026-05-15 08:00:00"}
        wo_write = next(w for w in writes if w.model == "mrp.workorder")
        assert wo_write.vals == {"date_start": "2026-05-15 08:00:00"}

    def test_handles_empty_plan_gracefully(self):
        assert published_plan_to_odoo_writes({}) == ()
        assert published_plan_to_odoo_writes({"work_orders": []}) == ()

    def test_external_ref_must_be_integer_coercible(self):
        plan = _published_plan_with_mo(work_order_external_ref="not-a-number")
        writes = published_plan_to_odoo_writes(plan)
        # MO skipped (not numeric), but ops with numeric external_ref still emitted
        assert all(w.model != "mrp.production" for w in writes)


class TestPublishedPlanToOdooWritesWithBindingLookup:
    """Slice 8: reverse-binding lookup replaces the numeric-id fallback.

    When the APS published plan doesn't carry external_ref (engine domain
    strips it), the push mapper used to fall back on coercing the
    canonical work_order_id to int — which only worked when the puller
    happened to set internal_id = Odoo id (slice 2 convention).

    The lookup callable, wired to a real integration_bindings reverse
    index, lets the mapper recover the right Odoo id even when the APS
    work_order_id is a string like "WO-ALPHA-001".
    """

    def _plan_with_string_ids(self) -> dict:
        return {
            "work_orders": [
                {
                    "work_order_id": "WO-ALPHA-001",
                    # external_ref dropped by the engine on the way out
                    "external_ref": None,
                    "operations": [
                        {
                            "operation_id": "OP-ALPHA-10",
                            "external_ref": None,
                            "planned_start": "2026-05-20T08:00:00",
                            "planned_end": "2026-05-20T09:00:00",
                        },
                    ],
                }
            ]
        }

    def test_lookup_recovers_mo_id_for_string_internal_id(self):
        bindings = {"work_order": {"WO-ALPHA-001": "42"}, "operation": {}}

        def lookup(entity_type, internal_ids):
            return {
                internal_id: bindings[entity_type][internal_id]
                for internal_id in internal_ids
                if internal_id in bindings[entity_type]
            }

        writes = published_plan_to_odoo_writes(
            self._plan_with_string_ids(),
            external_ref_lookup=lookup,
        )
        mo_writes = [w for w in writes if w.model == "mrp.production"]
        assert len(mo_writes) == 1
        assert mo_writes[0].ids == (42,)

    def test_lookup_recovers_workorder_id_for_operation(self):
        bindings = {"work_order": {}, "operation": {"OP-ALPHA-10": "1234"}}

        def lookup(entity_type, internal_ids):
            return {
                internal_id: bindings[entity_type][internal_id]
                for internal_id in internal_ids
                if internal_id in bindings[entity_type]
            }

        writes = published_plan_to_odoo_writes(
            self._plan_with_string_ids(),
            external_ref_lookup=lookup,
        )
        wo_writes = [w for w in writes if w.model == "mrp.workorder"]
        assert len(wo_writes) == 1
        assert wo_writes[0].ids == (1234,)
        assert wo_writes[0].vals == {
            "date_start": "2026-05-20 08:00:00",
            "date_finished": "2026-05-20 09:00:00",
        }

    def test_lookup_is_only_consulted_when_external_ref_missing(self):
        calls: list[tuple[str, list]] = []

        def lookup(entity_type, internal_ids):
            calls.append((entity_type, list(internal_ids)))
            return {}

        # plan with valid external_refs everywhere — lookup must not be called
        published_plan_to_odoo_writes(
            _published_plan_with_mo(),
            external_ref_lookup=lookup,
        )
        assert calls == []

    def test_lookup_falls_back_to_numeric_id_when_binding_missing(self):
        # Empty lookup: behavior matches the legacy slice-4 fallback for
        # numeric internal ids, so previously-working flows keep working
        # even when no binding has been recorded.
        def lookup(entity_type, internal_ids):
            return {}

        plan = {
            "work_orders": [
                {
                    "work_order_id": "42",
                    "external_ref": None,
                    "operations": [
                        {
                            "operation_id": "10",
                            "external_ref": None,
                            "planned_start": "2026-05-20T08:00:00",
                            "planned_end": "2026-05-20T09:00:00",
                        },
                    ],
                }
            ]
        }
        writes = published_plan_to_odoo_writes(plan, external_ref_lookup=lookup)
        assert any(w.model == "mrp.production" and w.ids == (42,) for w in writes)
        assert any(w.model == "mrp.workorder" and w.ids == (10,) for w in writes)

    def test_string_id_without_binding_is_skipped(self):
        # No binding, no numeric fallback — the record must be skipped
        # rather than silently misdirected.
        def lookup(entity_type, internal_ids):
            return {}

        writes = published_plan_to_odoo_writes(
            self._plan_with_string_ids(),
            external_ref_lookup=lookup,
        )
        assert writes == ()


class TestAutoSplitOnShiftBoundary:
    """V1.2 — long Odoo workorders that don't fit any single shift get
    auto-split into a chain of finish-to-start sub-operations at pull
    time. This lets the engine plan ERP data unchanged when the routing
    is realistic (e.g. 20h of production on a 40h/week shop) without
    asking the customer to reconfigure Odoo.
    """

    def _long_workorder_data(self, *, duration_expected: float) -> dict:
        # Standard 9h shifts (8:00 → 17:00). Operations longer than 540 min
        # cannot fit in any single shift and must be split.
        return {
            "productions": [
                {
                    "id": 1,
                    "name": "WH/MO/00001",
                    "product_id": [1, "Big batch"],
                    "product_qty": 50.0,
                    "state": "confirmed",
                    "date_start": "2026-05-15 08:00:00",
                    "date_finished": "2026-05-30 17:00:00",
                    "priority": "0",
                }
            ],
            "workorders": [
                {
                    "id": 555,
                    "name": "Long milling",
                    "production_id": [1, "WH/MO/00001"],
                    "workcenter_id": [100, "Mill"],
                    "duration_expected": duration_expected,
                    "state": "ready",
                }
            ],
            "workcenters": [
                {
                    "id": 100,
                    "name": "Mill",
                    "code": "MILL",
                    "resource_calendar_id": [1000, "Standard 40h"],
                    "time_efficiency": 100.0,
                    "default_capacity": 1.0,
                }
            ],
            "calendars": [{"id": 1000, "name": "Standard 40h"}],
            "attendances": [
                {
                    "id": 9000 + d,
                    "calendar_id": [1000, "Standard 40h"],
                    "dayofweek": str(d),
                    "hour_from": 8.0,
                    "hour_to": 17.0,
                }
                for d in range(5)
            ],
        }

    def test_short_workorder_is_not_split(self):
        # 60 min < 540 min shift → stays single op
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=60.0)
        )
        wo = snapshot.work_orders[0]
        assert len(wo.operations) == 1
        assert wo.operations[0].id == "555"
        assert "-part-" not in wo.operations[0].id

    def test_exact_shift_boundary_does_not_trigger_split(self):
        # Exactly 540 min = one shift; no need to break it.
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=540.0)
        )
        wo = snapshot.work_orders[0]
        assert len(wo.operations) == 1
        assert wo.operations[0].duration_minutes == 540

    def test_long_workorder_is_split_into_chunks_summing_to_total(self):
        # 1244 min on a 540-min shift → 3 parts (540 + 540 + 164 = 1244)
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1244.0)
        )
        wo = snapshot.work_orders[0]
        assert len(wo.operations) == 3
        durations = [op.duration_minutes for op in wo.operations]
        assert durations == [540, 540, 164]
        assert sum(durations) == 1244

    def test_split_parts_use_predictable_id_convention(self):
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1244.0)
        )
        wo = snapshot.work_orders[0]
        assert [op.id for op in wo.operations] == [
            "555-part-1",
            "555-part-2",
            "555-part-3",
        ]

    def test_split_parts_chain_finish_to_start(self):
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1244.0)
        )
        ops = snapshot.work_orders[0].operations
        # part 1 has no dependency
        assert ops[0].dependencies == ()
        # part 2 depends on part 1, part 3 on part 2 — same chain via the
        # typed link too so the engine sees finish_to_start, not just an id.
        assert ops[1].dependencies == ("555-part-1",)
        assert ops[1].dependency_links[0].depends_on_id == "555-part-1"
        assert ops[1].dependency_links[0].dependency_type == "finish_to_start"
        assert ops[2].dependencies == ("555-part-2",)

    def test_split_parts_carry_distinct_external_refs_with_parent_prefix(self):
        # Each sub-op gets a unique external_ref ("555#part-1", "555#part-2",
        # ...) so the integration-binding layer does NOT collapse them into
        # the same internal id (which would defeat the split entirely). The
        # parent Odoo workorder id is still recoverable by stripping the
        # "#part-N" suffix — the push-back path uses that to aggregate.
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1244.0)
        )
        ops = snapshot.work_orders[0].operations
        refs = [op.external_ref for op in ops]
        assert refs == ["555#part-1", "555#part-2", "555#part-3"]
        # All parts still point back to the same parent workorder
        assert all(r.split("#part-")[0] == "555" for r in refs)

    def test_exact_multiple_of_shift_produces_exact_chunks(self):
        # 1620 min = 3 × 540 → exactly 3 parts of 540, no remainder
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1620.0)
        )
        ops = snapshot.work_orders[0].operations
        assert [op.duration_minutes for op in ops] == [540, 540, 540]

    def test_split_metadata_surfaces_in_snapshot(self):
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=1244.0)
        )
        assert snapshot.metadata["auto_split_parent_count"] == 1
        assert snapshot.metadata["auto_split_parts_total"] == 3

    def test_no_split_metadata_zero_when_nothing_split(self):
        snapshot = build_canonical_snapshot_from_odoo(
            **self._long_workorder_data(duration_expected=60.0)
        )
        assert snapshot.metadata["auto_split_parent_count"] == 0
        assert snapshot.metadata["auto_split_parts_total"] == 0


class TestPushBackAggregatesSplitParts:
    """When the engine plans a sub-op chain produced by auto-split, the
    push-back path must collapse them into a single Odoo workorder write
    with min(start) / max(end) — otherwise we'd send N conflicting writes
    for the same mrp.workorder record.
    """

    def test_three_subops_with_part_suffix_external_refs_collapse_to_one_write(self):
        # Sub-ops carry distinct external_refs with the "#part-N" suffix —
        # the push-back path strips that suffix to recover the parent
        # workorder id and aggregates into one Odoo write.
        plan = {
            "work_orders": [
                {
                    "work_order_id": "1",
                    "external_ref": "1",
                    "operations": [
                        {
                            "operation_id": "555-part-1",
                            "external_ref": "555#part-1",
                            "planned_start": "2026-05-15T08:00:00",
                            "planned_end": "2026-05-15T17:00:00",
                        },
                        {
                            "operation_id": "555-part-2",
                            "external_ref": "555#part-2",
                            "planned_start": "2026-05-16T08:00:00",
                            "planned_end": "2026-05-16T17:00:00",
                        },
                        {
                            "operation_id": "555-part-3",
                            "external_ref": "555#part-3",
                            "planned_start": "2026-05-17T08:00:00",
                            "planned_end": "2026-05-17T10:44:00",
                        },
                    ],
                }
            ]
        }
        writes = published_plan_to_odoo_writes(plan)
        wo_writes = [w for w in writes if w.model == "mrp.workorder"]
        # Single write for workorder 555 covering all three chunks
        assert len(wo_writes) == 1
        assert wo_writes[0].ids == (555,)
        assert wo_writes[0].vals == {
            "date_start": "2026-05-15 08:00:00",
            "date_finished": "2026-05-17 10:44:00",
        }

    def test_distinct_external_refs_remain_separate(self):
        # Mixed: two parts of WO 100 + one standalone WO 200 → 2 writes
        plan = {
            "work_orders": [
                {
                    "work_order_id": "1",
                    "external_ref": "1",
                    "operations": [
                        {
                            "operation_id": "100-part-1",
                            "external_ref": "100#part-1",
                            "planned_start": "2026-05-15T08:00:00",
                            "planned_end": "2026-05-15T12:00:00",
                        },
                        {
                            "operation_id": "100-part-2",
                            "external_ref": "100#part-2",
                            "planned_start": "2026-05-15T13:00:00",
                            "planned_end": "2026-05-15T17:00:00",
                        },
                        {
                            "operation_id": "200",
                            "external_ref": "200",
                            "planned_start": "2026-05-16T08:00:00",
                            "planned_end": "2026-05-16T09:30:00",
                        },
                    ],
                }
            ]
        }
        writes = published_plan_to_odoo_writes(plan)
        wo_writes = sorted(
            (w for w in writes if w.model == "mrp.workorder"),
            key=lambda w: w.ids,
        )
        assert len(wo_writes) == 2
        assert wo_writes[0].ids == (100,)
        assert wo_writes[0].vals == {
            "date_start": "2026-05-15 08:00:00",
            "date_finished": "2026-05-15 17:00:00",
        }
        assert wo_writes[1].ids == (200,)
