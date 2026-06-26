"""V1.2 Cas 2 — firmness survives the JSON codec round-trip.

The Studio runs flows like ``odoo_pull -> transform -> import_aps``
by serialising the canonical snapshot to JSON between blocks. If
the codec drops the firmness field, a forecast MO tagged by the
Odoo mapper would be silently re-imported as firm — exactly the
silent-demotion footgun the engine slice was built to prevent.

These tests pin the codec contract on its own (independent of
the API layer + the engine):
  - to_json preserves firmness for non-default values
  - from_json defaults missing field to "firm" (legacy snapshots)
"""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.application.integration.canonical_snapshot import (
    CanonicalOperation,
    CanonicalWorkOrder,
)
from planiadvance_v2.application.integration.snapshot_codec import (
    _operation_from_json,
    _work_order_from_json,
    _work_order_to_json,
)


def _make_wo(firmness: str) -> CanonicalWorkOrder:
    return CanonicalWorkOrder(
        id="WO-1",
        name="Test WO",
        product_id="P-1",
        quantity=10,
        due_date=datetime(2026, 6, 1, 17, 0),
        release_date=datetime(2026, 6, 1, 8, 0),
        operations=(),
        firmness=firmness,
    )


def test_to_json_emits_forecast_firmness() -> None:
    """A WO tagged forecast by the Odoo mapper must keep that tag
    when the Studio serialises it for the next block in the flow."""

    wo = _make_wo("forecast")
    payload = _work_order_to_json(wo)
    assert payload["firmness"] == "forecast"


def test_to_json_emits_tentative_firmness() -> None:
    wo = _make_wo("tentative")
    payload = _work_order_to_json(wo)
    assert payload["firmness"] == "tentative"


def test_from_json_defaults_missing_field_to_firm() -> None:
    """A legacy snapshot persisted before the field existed must
    NOT silently demote its WOs to forecast on re-import. Missing
    firmness reads as "firm" (the safe default)."""

    legacy_payload = {
        "id": "WO-LEGACY",
        "name": "Legacy",
        "product_id": "P-1",
        "quantity": 1,
        "due_date": "2026-06-01T17:00:00",
        "release_date": "2026-06-01T08:00:00",
        "operations": [],
    }
    wo = _work_order_from_json(legacy_payload)
    assert wo.firmness == "firm"


def test_round_trip_preserves_forecast() -> None:
    """End-to-end: encode -> decode produces an identical
    firmness field. The transform between blocks is JSON, so a
    forecast tag MUST survive a full serialise/parse cycle."""

    wo = _make_wo("forecast")
    encoded = _work_order_to_json(wo)
    decoded = _work_order_from_json(encoded)
    assert decoded.firmness == "forecast"


def test_round_trip_preserves_firm_explicit() -> None:
    wo = _make_wo("firm")
    encoded = _work_order_to_json(wo)
    decoded = _work_order_from_json(encoded)
    assert decoded.firmness == "firm"


def test_operation_codec_unaffected() -> None:
    """Smoke check: the per-operation codec doesn't touch
    firmness (it lives on the WO). Importing a minimal operation
    payload still works after the WO codec change."""

    op_payload = {
        "id": "OP-1",
        "work_order_id": "WO-1",
        "sequence": 1,
        "name": "op",
        "duration_minutes": 60,
        "eligible_machine_ids": ["M1"],
    }
    op = _operation_from_json(op_payload)
    assert isinstance(op, CanonicalOperation)
    assert op.duration_minutes == 60
