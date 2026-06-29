"""Phase 8 — starter templates registry."""

from __future__ import annotations

from planiadvance_v2.application.integration.flow_templates import FLOW_TEMPLATES
from planiadvance_v2.application.use_cases.integration_flows import (
    SUPPORTED_FLOW_BLOCK_TYPES,
)


def test_five_templates_exposed():
    """v1 ships 5 starter recipes; v2 ports the same set."""
    keys = {t["key"] for t in FLOW_TEMPLATES}
    assert keys == {
        "erp-import",
        "erp-return-delta",
        "erp-return-full",
        "aps-database-export",
        "aps-sftp-export",
    }


def test_each_template_has_title_description_and_blocks():
    for tpl in FLOW_TEMPLATES:
        assert isinstance(tpl["title"], str) and tpl["title"]
        assert isinstance(tpl["description"], str) and tpl["description"]
        assert isinstance(tpl["blocks"], tuple) and len(tpl["blocks"]) >= 2


def test_every_template_block_uses_a_known_block_type():
    """Drift between recipe blocks and FLOW_BLOCK_CATALOG breaks Studio rendering."""
    for tpl in FLOW_TEMPLATES:
        for block in tpl["blocks"]:
            assert (
                block["block_type"] in SUPPORTED_FLOW_BLOCK_TYPES
            ), f"{tpl['key']} references unknown block_type {block['block_type']}"


def test_blocks_form_a_linear_chain():
    """Templates use legacy input_block_id chaining (v1-compatible)."""
    for tpl in FLOW_TEMPLATES:
        block_ids = [b["id"] for b in tpl["blocks"]]
        for index, block in enumerate(tpl["blocks"]):
            if index == 0:
                continue
            assert block["input_block_id"] == block_ids[index - 1], (
                f"{tpl['key']} block {block['id']} should chain from "
                f"{block_ids[index - 1]}"
            )


def test_erp_import_operation_field_map_covers_required_keys():
    """The starter ships an operation_field_map so planners don't see a
    `missing_operations` validate error end-to-end. The required keys are
    those `_operation_from_json` (snapshot_codec) reads without a default.
    """
    required_operation_keys = {
        "id",
        "work_order_id",
        "sequence",
        "name",
        "duration_minutes",
    }
    erp_import = next(t for t in FLOW_TEMPLATES if t["key"] == "erp-import")
    map_block = next(b for b in erp_import["blocks"] if b["id"] == "map-api")
    op_field_map = map_block["config"].get("operation_field_map") or {}
    missing = required_operation_keys - set(op_field_map.keys())
    assert not missing, (
        f"ERP→APS starter operation_field_map is missing required keys "
        f"{sorted(missing)} — planners get a missing_operations error or "
        f"a bare KeyError downstream."
    )


def test_erp_import_field_map_covers_canonical_required_fields():
    """The starter must declare every canonical work_order field downstream
    requires, otherwise the planner gets a hard ValidationError on Run.

    Required canonical work_order fields are owned by the
    `_check_required_canonical_fields` call in
    `application/use_cases/integration_flows.py`. Keep this list in sync.
    """
    required_canonical = {
        "id",
        "name",
        "product_id",
        "quantity",
        "due_date",
        "release_date",
    }
    erp_import = next(t for t in FLOW_TEMPLATES if t["key"] == "erp-import")
    map_block = next(b for b in erp_import["blocks"] if b["id"] == "map-api")
    field_map = map_block["config"]["work_order_field_map"]
    missing = required_canonical - set(field_map.keys())
    assert not missing, (
        f"ERP→APS starter work_order_field_map is missing canonical "
        f"keys {sorted(missing)} — planners using the starter as-is will "
        f"hit a Map API To APS error on Run."
    )
