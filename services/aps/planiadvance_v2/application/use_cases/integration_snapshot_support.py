"""Shared helpers for snapshot-based integration execution."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ...application.integration.canonical_snapshot import CanonicalPlanningSnapshot
from ...application.integration.snapshot_codec import (
    planning_snapshot_from_json,
    planning_snapshot_hash,
    planning_snapshot_to_json,
)
from ...domain.errors import ValidationError
from ...domain.value_objects import TransferTimes


def snapshot_entity_counts(snapshot: CanonicalPlanningSnapshot) -> dict[str, int]:
    return {
        "calendars": len(snapshot.calendars),
        "machines": len(snapshot.machines),
        "resources": len(snapshot.resources),
        "work_orders": len(snapshot.work_orders),
        "operations": sum(len(work_order.operations) for work_order in snapshot.work_orders),
        "inventory_items": len(snapshot.inventory_items),
        "supplies": len(snapshot.supplies),
    }


def transfer_times_from_config(config: dict[str, object]) -> TransferTimes:
    raw = config.get("transfer_times")
    if not isinstance(raw, dict):
        return TransferTimes()
    pairs: dict[tuple[str, str], int] = {}
    raw_pairs = raw.get("pairs")
    if isinstance(raw_pairs, list):
        for pair in raw_pairs:
            if not isinstance(pair, dict):
                continue
            source = pair.get("from_machine", pair.get("from"))
            target = pair.get("to_machine", pair.get("to"))
            minutes = pair.get("minutes", 0)
            if source is not None and target is not None:
                pairs[(str(source), str(target))] = int(minutes)
    return TransferTimes(
        default_minutes=int(raw.get("default_minutes", 0)),
        pairs=pairs,
    )


def http_body_from_config(config: dict[str, object]) -> bytes | None:
    value = config.get("request_body")
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value).encode("utf-8")
    text = str(value)
    return text.encode("utf-8") if text else None


def snapshot_envelope(
    snapshot: CanonicalPlanningSnapshot,
    **extra: object,
) -> dict[str, object]:
    snapshot_json = planning_snapshot_to_json(snapshot)
    return {
        "kind": "snapshot",
        "snapshot": snapshot_json,
        "snapshot_hash": planning_snapshot_hash(snapshot_json),
        "entity_counts": snapshot_entity_counts(snapshot),
        **extra,
    }


def extract_snapshot_json(
    value: object,
    *,
    label: str = "snapshot block input",
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be a snapshot envelope.")
    snapshot = value.get("snapshot")
    if not isinstance(snapshot, dict):
        raise ValidationError(f"{label} does not include a canonical snapshot payload.")
    return clone_json(snapshot)


def extract_snapshot(
    value: object,
    *,
    label: str = "snapshot block input",
) -> CanonicalPlanningSnapshot:
    return planning_snapshot_from_json(extract_snapshot_json(value, label=label))


def clone_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def optional_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))
