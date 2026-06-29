"""Map raw Odoo search_read results into a CanonicalPlanningSnapshot.

The mapper is intentionally tolerant: Odoo data is often incomplete
(MOs without routings, workcenters not configured, calendars empty),
so the block we ship synthesizes structurally-valid defaults instead
of failing. A planner can connect Odoo on day one even if their MRP
setup is minimal, and refine the routing model later.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Any

from .canonical_mapper import CONTRACT_VERSION
from .canonical_snapshot import (
    CanonicalCalendar,
    CanonicalDependencyLink,
    CanonicalMachine,
    CanonicalOperation,
    CanonicalPlanningSnapshot,
    CanonicalShift,
    CanonicalWorkOrder,
)

DEFAULT_MACHINE_ID = "ODOO_DEFAULT_MACHINE"
DEFAULT_CALENDAR_ID = "ODOO_DEFAULT_CALENDAR"
DEFAULT_DUE_DATE_OFFSET_DAYS = 7

_ODOO_PRIORITY_TO_APS = {
    "0": "normal",
    "1": "normal",
    "2": "high",
    "3": "high",
}

# Odoo mrp.production.state -> APS WorkOrderStatus
_ODOO_MO_STATE_TO_APS = {
    "draft": "released",
    "confirmed": "released",
    "progress": "in_progress",
    "to_close": "in_progress",
    "done": "completed",
    "cancel": "cancelled",
}

# Odoo mrp.workorder.state -> APS OperationStatus
_ODOO_WO_STATE_TO_APS = {
    "pending": "pending",
    "waiting": "pending",
    "ready": "scheduled",
    "progress": "in_progress",
    "done": "completed",
    "cancel": "pending",
}


def parse_odoo_hour_to_time(hour: float) -> time:
    """Odoo encodes hours as decimal floats (8.5 -> 8:30)."""
    if hour >= 24.0:
        return time(23, 59)
    if hour < 0:
        return time(0, 0)
    whole = int(hour)
    minute = int(round((hour - whole) * 60))
    if minute >= 60:
        whole += 1
        minute = 0
    return time(whole, minute)


def parse_odoo_datetime(value: Any) -> datetime | None:
    """Odoo returns False/empty when a datetime is unset."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


def _m2o_id(value: Any) -> str | None:
    """Odoo many2one fields serialize as [id, display_name] or False."""
    if not value:
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 1:
        return str(value[0])
    return str(value)


def _map_attendances_to_shifts(
    attendances: list[dict],
    calendar_id_str: str,
) -> tuple[CanonicalShift, ...]:
    shifts: list[CanonicalShift] = []
    for entry in attendances:
        if _m2o_id(entry.get("calendar_id")) != calendar_id_str:
            continue
        dayofweek = entry.get("dayofweek")
        try:
            weekday = int(dayofweek) if dayofweek is not None else None
        except (TypeError, ValueError):
            weekday = None
        if weekday is None:
            continue
        hour_from = entry.get("hour_from")
        hour_to = entry.get("hour_to")
        if hour_from is None or hour_to is None:
            continue
        shifts.append(
            CanonicalShift(
                weekday=weekday,
                start=parse_odoo_hour_to_time(float(hour_from)),
                end=parse_odoo_hour_to_time(float(hour_to)),
            )
        )
    shifts.sort(key=lambda s: (s.weekday, s.start))
    return tuple(shifts)


def _map_calendars(
    calendars: list[dict],
    attendances: list[dict],
) -> tuple[CanonicalCalendar, ...]:
    mapped: list[CanonicalCalendar] = []
    for cal in calendars:
        cal_id = str(cal.get("id"))
        mapped.append(
            CanonicalCalendar(
                id=cal_id,
                name=str(cal.get("name") or f"Calendar {cal_id}"),
                shifts=_map_attendances_to_shifts(attendances, cal_id),
            )
        )
    return tuple(mapped)


def _default_calendar() -> CanonicalCalendar:
    return CanonicalCalendar(
        id=DEFAULT_CALENDAR_ID,
        name="Default 5x8",
        shifts=tuple(
            CanonicalShift(weekday=d, start=time(8, 0), end=time(17, 0))
            for d in range(5)
        ),
    )


def _map_workcenters(
    workcenters: list[dict],
    fallback_calendar_id: str,
) -> tuple[CanonicalMachine, ...]:
    mapped: list[CanonicalMachine] = []
    for wc in workcenters:
        cal_id = _m2o_id(wc.get("resource_calendar_id")) or fallback_calendar_id
        efficiency_raw = wc.get("time_efficiency", 100.0)
        try:
            efficiency = float(efficiency_raw)
        except (TypeError, ValueError):
            efficiency = 100.0
        # Odoo reports efficiency as a percentage (100.0 = 1.0 in APS terms).
        if efficiency > 5:
            efficiency = efficiency / 100.0
        mapped.append(
            CanonicalMachine(
                id=str(wc.get("id")),
                name=str(wc.get("name") or f"WC {wc.get('id')}"),
                calendar_id=cal_id,
                capabilities=(),
                efficiency=max(efficiency, 0.01),
            )
        )
    return tuple(mapped)


def _default_machine(calendar_id: str) -> CanonicalMachine:
    return CanonicalMachine(
        id=DEFAULT_MACHINE_ID,
        name="Default workcenter (Odoo)",
        calendar_id=calendar_id,
        capabilities=(),
        efficiency=1.0,
    )


def _calendar_max_shift_minutes(calendar: CanonicalCalendar) -> int:
    """Longest single shift in this calendar, in minutes.

    A single APS operation is atomic — it must fit inside one contiguous
    shift window. The auto-split pass uses this max to break an Odoo
    workorder whose ``duration_expected`` exceeds any shift into a chain
    of finish-to-start sub-operations the engine can place.
    """
    longest = 0
    for shift in calendar.shifts:
        start_m = shift.start.hour * 60 + shift.start.minute
        end_m = shift.end.hour * 60 + shift.end.minute
        span = end_m - start_m
        if span > longest:
            longest = span
    return longest


def _machine_max_shift_minutes(
    machines: tuple[CanonicalMachine, ...],
    calendars: tuple[CanonicalCalendar, ...],
) -> dict[str, int]:
    cal_max = {cal.id: _calendar_max_shift_minutes(cal) for cal in calendars}
    return {m.id: cal_max.get(m.calendar_id, 0) for m in machines}


def _effective_max_shift_minutes(
    eligible_machine_ids: tuple[str, ...],
    machine_max: dict[str, int],
) -> int:
    """Min of max-shift across the eligible machines.

    Conservative on purpose: split so every part fits regardless of which
    eligible machine the scheduler picks. Returns 0 when no machine has
    a usable calendar (caller falls back to "do not split").
    """
    spans = [machine_max.get(mid, 0) for mid in eligible_machine_ids]
    usable = [s for s in spans if s > 0]
    if not usable:
        return 0
    return min(usable)


# Suffix used to encode a split sub-operation's position inside its
# parent Odoo workorder's external_ref. Each sub-op gets its own unique
# external_ref ("125#part-1", "125#part-2", ...) so the integration
# binding layer does not collapse them onto the same internal id. The
# push-back path strips the suffix to recover the parent's workorder
# id and aggregates the sub-ops back into a single Odoo write.
SPLIT_PART_SEPARATOR = "#part-"


def _split_operation_into_parts(
    base: CanonicalOperation,
    *,
    max_chunk_minutes: int,
) -> tuple[CanonicalOperation, ...]:
    """Break ``base`` into a chain of sub-ops each ≤ ``max_chunk_minutes``.

    No-op when ``max_chunk_minutes`` is 0 (no calendar info) or when the
    base op already fits. Sub-op ids use the convention
    ``{base.id}-part-{n}`` and external_refs use
    ``{parent_ref}{SPLIT_PART_SEPARATOR}{n}`` so each sub-op gets a
    distinct binding key (importer indexes by external_ref) while the
    push-back logic can still strip the suffix to aggregate back into a
    single Odoo workorder write.
    """
    if max_chunk_minutes <= 0 or base.duration_minutes <= max_chunk_minutes:
        return (base,)
    parent_ref = base.external_ref or base.id
    parts: list[CanonicalOperation] = []
    remaining = base.duration_minutes
    idx = 0
    while remaining > 0:
        idx += 1
        chunk = min(max_chunk_minutes, remaining)
        part_id = f"{base.id}-part-{idx}"
        part_external_ref = f"{parent_ref}{SPLIT_PART_SEPARATOR}{idx}"
        deps: tuple[str, ...] = ()
        dep_links: tuple[CanonicalDependencyLink, ...] = ()
        if idx > 1:
            prev_id = f"{base.id}-part-{idx - 1}"
            deps = (prev_id,)
            dep_links = (
                CanonicalDependencyLink(
                    depends_on_id=prev_id,
                    dependency_type="finish_to_start",
                ),
            )
        parts.append(
            CanonicalOperation(
                id=part_id,
                work_order_id=base.work_order_id,
                sequence=base.sequence,
                name=f"{base.name} (part {idx})",
                duration_minutes=chunk,
                eligible_machine_ids=base.eligible_machine_ids,
                status=base.status,
                dependencies=deps,
                dependency_links=dep_links,
                external_ref=part_external_ref,
            )
        )
        remaining -= chunk
    return tuple(parts)


def _map_workorder_to_operation(
    record: dict,
    *,
    sequence: int,
    all_machine_ids: tuple[str, ...],
    default_duration: int,
    machine_max_shift: dict[str, int],
) -> tuple[CanonicalOperation, ...]:
    workcenter_id = _m2o_id(record.get("workcenter_id"))
    if workcenter_id and workcenter_id in all_machine_ids:
        eligible = (workcenter_id,)
    else:
        eligible = all_machine_ids
    duration_raw = record.get("duration_expected") or 0
    try:
        duration = int(float(duration_raw))
    except (TypeError, ValueError):
        duration = 0
    if duration <= 0:
        duration = default_duration
    odoo_state = str(record.get("state") or "").lower()
    aps_status = _ODOO_WO_STATE_TO_APS.get(odoo_state, "pending")
    base_id = str(record.get("id"))
    base = CanonicalOperation(
        id=base_id,
        work_order_id=str(_m2o_id(record.get("production_id")) or ""),
        sequence=sequence,
        name=str(record.get("name") or f"Operation {record.get('id')}"),
        duration_minutes=duration,
        eligible_machine_ids=eligible,
        status=aps_status,
        external_ref=base_id,
    )
    max_chunk = _effective_max_shift_minutes(eligible, machine_max_shift)
    return _split_operation_into_parts(base, max_chunk_minutes=max_chunk)


def _synthesize_default_operation(
    work_order_id: str,
    *,
    work_order_name: str,
    duration_minutes: int,
    all_machine_ids: tuple[str, ...],
    machine_max_shift: dict[str, int],
) -> tuple[CanonicalOperation, ...]:
    base = CanonicalOperation(
        id=f"OP-{work_order_id}-DEFAULT",
        work_order_id=work_order_id,
        sequence=1,
        name=f"Manufacture {work_order_name}",
        duration_minutes=duration_minutes,
        eligible_machine_ids=all_machine_ids,
        status="pending",
    )
    max_chunk = _effective_max_shift_minutes(all_machine_ids, machine_max_shift)
    return _split_operation_into_parts(base, max_chunk_minutes=max_chunk)


def _map_productions(
    productions: list[dict],
    workorders: list[dict],
    *,
    all_machine_ids: tuple[str, ...],
    default_duration: int,
    machine_max_shift: dict[str, int],
    now: datetime,
) -> tuple[CanonicalWorkOrder, ...]:
    # Defensive de-dup: Odoo search_read can return the same workorder
    # twice in rare relational edge cases (e.g. union queries via
    # inherited models). The downstream CanonicalPlanningSnapshot
    # validation rejects any work_order whose operations share an id,
    # so collapsing duplicates here keeps the pipeline tolerant of ERP
    # quirks instead of failing the whole import for one stray row.
    wos_by_production: dict[str, list[dict]] = {}
    seen_wo_ids: set[str] = set()
    for wo in workorders:
        prod_id = _m2o_id(wo.get("production_id"))
        if prod_id is None:
            continue
        wo_id = str(wo.get("id"))
        if wo_id in seen_wo_ids:
            continue
        seen_wo_ids.add(wo_id)
        wos_by_production.setdefault(prod_id, []).append(wo)

    mapped: list[CanonicalWorkOrder] = []
    for prod in productions:
        prod_id = str(prod.get("id"))
        related_wos = wos_by_production.get(prod_id, [])
        # Map then deduplicate by op id. The wos_by_production grouping
        # already deduplicates incoming workorder records by their Odoo
        # id, but a second guard at the operation level protects against
        # any future synthesizer/split path emitting colliding ids: the
        # snapshot validator rejects work_orders whose operation ids are
        # not unique, and we want the whole import to succeed even when
        # one row is malformed rather than fail the entire 1000-MO pull.
        op_buffer: list[CanonicalOperation] = []
        seen_op_ids: set[str] = set()
        for idx, wo in enumerate(related_wos):
            for op in _map_workorder_to_operation(
                wo,
                sequence=idx + 1,
                all_machine_ids=all_machine_ids,
                default_duration=default_duration,
                machine_max_shift=machine_max_shift,
            ):
                if op.id in seen_op_ids:
                    continue
                seen_op_ids.add(op.id)
                op_buffer.append(op)
        operations: tuple[CanonicalOperation, ...] = tuple(op_buffer)
        work_order_name = str(prod.get("name") or f"MO {prod_id}")
        if not operations:
            operations = _synthesize_default_operation(
                prod_id,
                work_order_name=work_order_name,
                duration_minutes=default_duration,
                all_machine_ids=all_machine_ids,
                machine_max_shift=machine_max_shift,
            )

        release_date = parse_odoo_datetime(prod.get("date_start")) or now
        due_date = (
            parse_odoo_datetime(prod.get("date_finished"))
            or release_date + timedelta(days=DEFAULT_DUE_DATE_OFFSET_DAYS)
        )
        if due_date <= release_date:
            due_date = release_date + timedelta(days=DEFAULT_DUE_DATE_OFFSET_DAYS)

        quantity_raw = prod.get("product_qty") or 0
        try:
            quantity = max(int(float(quantity_raw)), 1)
        except (TypeError, ValueError):
            quantity = 1

        priority = _ODOO_PRIORITY_TO_APS.get(str(prod.get("priority") or "0"), "normal")

        odoo_state = str(prod.get("state") or "").lower()
        aps_status = _ODOO_MO_STATE_TO_APS.get(odoo_state, "released")
        # V1.2 Cas 2 — Odoo state mapping for firmness. Draft MOs are
        # typically the output of Odoo's demand-driven MRP / forecast
        # module (not yet released to the shop floor); confirmed and
        # later states are real production commitments. The mapping
        # is conservative — anything we don't recognise defaults to
        # FIRM so a misconfigured field doesn't accidentally demote
        # a real customer order.
        firmness = "forecast" if odoo_state == "draft" else "firm"
        mapped.append(
            CanonicalWorkOrder(
                id=prod_id,
                name=work_order_name,
                product_id=_m2o_id(prod.get("product_id")) or "unknown",
                quantity=quantity,
                release_date=release_date,
                due_date=due_date,
                operations=operations,
                priority=priority,
                status=aps_status,
                firmness=firmness,
                external_ref=prod_id,
                erp_status=odoo_state,
            )
        )
    return tuple(mapped)


def build_canonical_snapshot_from_odoo(
    *,
    productions: list[dict],
    workorders: list[dict],
    workcenters: list[dict],
    calendars: list[dict],
    attendances: list[dict],
    source_system: str = "odoo",
    default_operation_duration_minutes: int = 60,
    now: datetime | None = None,
) -> CanonicalPlanningSnapshot:
    """Combine five Odoo search_read result sets into one canonical snapshot.

    Synthesizes structurally-required defaults when Odoo data is sparse:
    - Empty workcenter list -> one DEFAULT machine attached to the first
      (real or synthetic) calendar.
    - Empty workorder list under a production -> one synthetic operation
      whose duration falls back to ``default_operation_duration_minutes``
      and which is eligible on every known machine.
    - Empty calendar list -> a 5x8 default calendar.
    """

    now = now or datetime.utcnow()

    canonical_calendars = _map_calendars(calendars, attendances)
    if not canonical_calendars:
        canonical_calendars = (_default_calendar(),)

    canonical_machines = _map_workcenters(workcenters, fallback_calendar_id=canonical_calendars[0].id)
    if not canonical_machines:
        canonical_machines = (_default_machine(canonical_calendars[0].id),)

    machine_ids = tuple(m.id for m in canonical_machines)
    machine_max_shift = _machine_max_shift_minutes(canonical_machines, canonical_calendars)
    canonical_work_orders = _map_productions(
        productions,
        workorders,
        all_machine_ids=machine_ids,
        default_duration=default_operation_duration_minutes,
        machine_max_shift=machine_max_shift,
        now=now,
    )

    # Auto-split telemetry: how many ops were broken into chunks because
    # they didn't fit a shift. Surfaces to the Studio readiness panel so
    # the planner sees this is happening, instead of the data quietly
    # mutating between Odoo and the engine.
    split_parents = 0
    split_parts_total = 0
    for wo in canonical_work_orders:
        parts_by_parent: dict[str, int] = {}
        for op in wo.operations:
            if "-part-" in op.id:
                parent = op.id.rsplit("-part-", 1)[0]
                parts_by_parent[parent] = parts_by_parent.get(parent, 0) + 1
        split_parents += len(parts_by_parent)
        split_parts_total += sum(parts_by_parent.values())

    return CanonicalPlanningSnapshot(
        contract_version=CONTRACT_VERSION,
        exported_at=now,
        source_system=source_system,
        calendars=canonical_calendars,
        machines=canonical_machines,
        work_orders=canonical_work_orders,
        metadata={
            "vendor": "odoo",
            "productions_count": len(productions),
            "workorders_count": len(workorders),
            "workcenters_count": len(workcenters),
            "synthesized_default_machine": canonical_machines[0].id == DEFAULT_MACHINE_ID,
            "auto_split_parent_count": split_parents,
            "auto_split_parts_total": split_parts_total,
        },
    )


# ---------------------------------------------------------------------------
# PUSH back: published_plan -> Odoo write payloads
# ---------------------------------------------------------------------------

ODOO_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"


@dataclass(frozen=True, slots=True)
class OdooWriteOp:
    """One write call to dispatch against Odoo."""

    model: str
    ids: tuple[int, ...]
    vals: dict[str, Any]


def format_odoo_datetime(value: Any) -> str | None:
    """Render a datetime (or ISO string) as the naive UTC string Odoo expects."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime(ODOO_DATETIME_FORMAT)
    text = str(value).strip()
    if not text:
        return None
    # Tolerate ISO-8601 with trailing Z or offsets, normalize to naive UTC string.
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(tz=None).replace(tzinfo=None)
    return parsed.strftime(ODOO_DATETIME_FORMAT)


def _coerce_int_id(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _operation_window(operations: list[dict]) -> tuple[datetime | None, datetime | None]:
    starts: list[datetime] = []
    ends: list[datetime] = []
    for op in operations:
        start = _parse_iso(op.get("planned_start"))
        end = _parse_iso(op.get("planned_end"))
        if start is not None:
            starts.append(start)
        if end is not None:
            ends.append(end)
    return (min(starts) if starts else None, max(ends) if ends else None)


def _parse_iso(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(tz=None).replace(tzinfo=None)
    return parsed


ExternalRefLookup = Callable[[str, Iterable[str]], dict[str, str]]


def published_plan_to_odoo_writes(
    plan: dict[str, Any],
    *,
    external_ref_lookup: ExternalRefLookup | None = None,
) -> tuple[OdooWriteOp, ...]:
    """Translate a published_plan dict into Odoo write operations.

    Emits one write per source record so failures are isolated and per-record
    error messages stay meaningful. Records without a resolvable Odoo target
    or without any planned dates are skipped — they can't be reflected back.

    Mapping:
    - work_order target id + min/max of operation planned dates ->
      mrp.production.write({date_start, date_finished})
    - operation target id + planned_start/end ->
      mrp.workorder.write({date_start, date_finished})

    Target id resolution, in order:
    1. The published plan's ``external_ref`` field (set by the puller).
    2. ``external_ref_lookup(entity_type, internal_ids)`` if supplied —
       this is how callers wire a real ``integration_bindings`` reverse
       lookup so non-numeric APS work_order ids can still be pushed back.
    3. The canonical ``work_order_id`` / ``operation_id`` coerced to int
       — works for the slice-2 puller convention where APS id == Odoo id,
       but silently skips non-numeric ids (e.g. "WO-IND-ALPHA" demo data),
       which is the right default when no binding is configured.
    """

    work_orders = plan.get("work_orders") or []

    work_order_lookup: dict[str, str] = {}
    operation_lookup: dict[str, str] = {}
    if external_ref_lookup is not None:
        unresolved_wo_ids: list[str] = []
        unresolved_op_ids: list[str] = []
        for wo in work_orders:
            if not wo.get("external_ref"):
                wo_id = wo.get("work_order_id")
                if wo_id:
                    unresolved_wo_ids.append(str(wo_id))
            for op in wo.get("operations") or []:
                if not op.get("external_ref"):
                    op_id = op.get("operation_id")
                    if op_id:
                        unresolved_op_ids.append(str(op_id))
        if unresolved_wo_ids:
            work_order_lookup = external_ref_lookup("work_order", unresolved_wo_ids)
        if unresolved_op_ids:
            operation_lookup = external_ref_lookup("operation", unresolved_op_ids)

    writes: list[OdooWriteOp] = []
    for wo in work_orders:
        operations = wo.get("operations") or []
        mo_id = _coerce_int_id(wo.get("external_ref"))
        if mo_id is None:
            internal_wo = wo.get("work_order_id")
            if internal_wo is not None:
                resolved = work_order_lookup.get(str(internal_wo))
                if resolved is not None:
                    mo_id = _coerce_int_id(resolved)
            if mo_id is None:
                # No binding entry — fall back to the slice-2 numeric-id
                # convention. Non-numeric ids stay None and the record is
                # skipped below, which is what we want.
                mo_id = _coerce_int_id(wo.get("work_order_id"))
        if mo_id is not None:
            window_start, window_end = _operation_window(operations)
            vals: dict[str, Any] = {}
            if window_start is not None:
                vals["date_start"] = format_odoo_datetime(window_start)
            if window_end is not None:
                vals["date_finished"] = format_odoo_datetime(window_end)
            if vals:
                writes.append(
                    OdooWriteOp(model="mrp.production", ids=(mo_id,), vals=vals)
                )
        # Aggregate sub-operations sharing a parent workorder into a
        # single write. Auto-split at pull time produces N operations
        # whose external_refs are ``{parent_id}#part-{idx}`` — distinct
        # per sub-op (so the importer's binding layer does not collapse
        # them) but sharing a parent prefix the push-back can recover.
        wo_windows: dict[int, tuple[datetime | None, datetime | None]] = {}
        for op in operations:
            raw_ref = op.get("external_ref")
            if isinstance(raw_ref, str) and SPLIT_PART_SEPARATOR in raw_ref:
                raw_ref = raw_ref.split(SPLIT_PART_SEPARATOR, 1)[0]
            workorder_id = _coerce_int_id(raw_ref)
            if workorder_id is None:
                internal_op = op.get("operation_id")
                if internal_op is not None:
                    resolved = operation_lookup.get(str(internal_op))
                    if resolved is not None:
                        workorder_id = _coerce_int_id(resolved)
                if workorder_id is None:
                    workorder_id = _coerce_int_id(op.get("operation_id"))
            if workorder_id is None:
                continue
            start = _parse_iso(op.get("planned_start"))
            end = _parse_iso(op.get("planned_end"))
            cur_start, cur_end = wo_windows.get(workorder_id, (None, None))
            if start is not None:
                cur_start = start if cur_start is None else min(cur_start, start)
            if end is not None:
                cur_end = end if cur_end is None else max(cur_end, end)
            wo_windows[workorder_id] = (cur_start, cur_end)

        for workorder_id, (win_start, win_end) in wo_windows.items():
            op_vals: dict[str, Any] = {}
            if win_start is not None:
                op_vals["date_start"] = format_odoo_datetime(win_start)
            if win_end is not None:
                op_vals["date_finished"] = format_odoo_datetime(win_end)
            if op_vals:
                writes.append(
                    OdooWriteOp(model="mrp.workorder", ids=(workorder_id,), vals=op_vals)
                )
    return tuple(writes)
