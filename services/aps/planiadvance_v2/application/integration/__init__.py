"""Integration helpers for canonical APS contracts."""

from .canonical_mapper import (
    CONTRACT_VERSION,
    export_planning_snapshot,
    export_schedule_snapshot,
    snapshot_to_context,
    snapshot_to_domain_inputs,
    validate_snapshot,
    validate_snapshot_report,
)
from .canonical_snapshot import CanonicalPlanningSnapshot
from .csv_adapter import CanonicalCsvBundle, snapshot_from_csv_bundle
from .odoo_client import (
    OdooAuthenticationError,
    OdooClient,
    OdooClientError,
    OdooRpcError,
)
from .snapshot_codec import (
    planning_snapshot_from_json,
    planning_snapshot_hash,
    planning_snapshot_to_json,
)

__all__ = [
    "CONTRACT_VERSION",
    "CanonicalPlanningSnapshot",
    "CanonicalCsvBundle",
    "OdooAuthenticationError",
    "OdooClient",
    "OdooClientError",
    "OdooRpcError",
    "export_planning_snapshot",
    "export_schedule_snapshot",
    "snapshot_to_domain_inputs",
    "snapshot_to_context",
    "validate_snapshot",
    "validate_snapshot_report",
    "snapshot_from_csv_bundle",
    "planning_snapshot_from_json",
    "planning_snapshot_hash",
    "planning_snapshot_to_json",
]
