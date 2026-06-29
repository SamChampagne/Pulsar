"""Phase 9 — connector_id config fields use field_type='connector'.

The Inspector renders a dropdown picker for connector fields; if the
catalog drifts back to 'text', the picker falls through to the free-text
input (which is the source of the bad UX Sam flagged on 2026-05-08).
"""

from __future__ import annotations

from planiadvance_v2.application.use_cases.integration_flows import FLOW_BLOCK_CATALOG


def test_connector_id_fields_use_connector_field_type():
    offenders: list[str] = []
    for item in FLOW_BLOCK_CATALOG:
        for field in item.get("config_fields") or ():
            if (
                field.get("key") == "connector_id"
                and field.get("field_type") != "connector"
            ):
                offenders.append(
                    f"{item['block_type']} → connector_id has "
                    f"field_type={field.get('field_type')!r}"
                )
    assert not offenders, (
        "Found connector_id fields not using field_type='connector':\n"
        + "\n".join(offenders)
    )


def test_select_placeholders_do_not_collide_with_option_values():
    """The Inspector select renders the placeholder as `<option value="">…</option>`
    above the real options. If a select's placeholder is also a valid
    option value (e.g. placeholder="json" while one option has
    value="json"), planners see the value twice in the dropdown — once
    as the placeholder, once as the actual option. Use human-readable
    placeholders ("Select a format…") for select fields instead.
    """
    offenders: list[str] = []
    for item in FLOW_BLOCK_CATALOG:
        for field in item.get("config_fields") or ():
            if field.get("field_type") != "select":
                continue
            placeholder = field.get("placeholder")
            if placeholder is None:
                continue
            option_values = {
                opt.get("value") for opt in (field.get("options") or ())
            }
            option_labels = {
                opt.get("label") for opt in (field.get("options") or ())
            }
            if placeholder in option_values or placeholder in option_labels:
                offenders.append(
                    f"{item['block_type']} → field {field.get('key')!r} "
                    f"placeholder {placeholder!r} collides with an option "
                    f"value/label"
                )
    assert not offenders, (
        "Select fields ship a placeholder that matches one of their option "
        "values/labels — the dropdown will show the value twice:\n"
        + "\n".join(offenders)
    )


def test_typed_destination_blocks_declare_connector_type():
    """Blocks whose runtime checks `connector.connector_type` against a
    specific type must declare the same `connector_type` on their
    connector_id config field, otherwise the Inspector dropdown lists
    every connector and a planner can pick a mismatched one — the runtime
    then refuses with `requires a connector with connector_type '<type>'`.
    """
    expected = {
        "send_sftp_file": "sftp",
        "write_database_rows": "database",
        "pull_snapshot_from_connector": "http",
        "call_connector_api": "http",
        "send_connector_request": "http",
        "push_snapshot_to_connector": "http",
        "push_published_plan_to_connector": "http",
    }
    for item in FLOW_BLOCK_CATALOG:
        block_type = item["block_type"]
        if block_type not in expected:
            continue
        connector_field = next(
            (f for f in item.get("config_fields") or () if f.get("key") == "connector_id"),
            None,
        )
        assert connector_field is not None, (
            f"{block_type} is missing a connector_id field"
        )
        assert connector_field.get("connector_type") == expected[block_type], (
            f"{block_type} → connector_id should declare "
            f"connector_type={expected[block_type]!r}, "
            f"got {connector_field.get('connector_type')!r}"
        )
