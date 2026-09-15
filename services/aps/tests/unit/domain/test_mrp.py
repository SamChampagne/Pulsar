from copy import deepcopy

import pytest

from planiadvance_v2.domain.mrp import MrpRequest, calculate_mrp


def item(key, method="BUY", stock="0", components=None, **kwargs):
    return dict(
        id=key,
        sku=key,
        name=key,
        unit="EA",
        method=method,
        on_hand=stock,
        components=components or [],
        **kwargs,
    )


def flow(key, qty, when="2026-09-20", ref="d1"):
    return dict(id=ref, item_id=key, quantity=str(qty), date=when, reference=ref)


def plan(items, demands=None, supplies=None):
    return calculate_mrp(
        MrpRequest.model_validate(
            dict(
                version="pulsar.mrp.v1",
                as_of="2026-09-15",
                horizon_end="2026-10-15",
                items=items,
                demands=demands or [],
                supplies=supplies or [],
            )
        )
    )


def test_multilevel_explodes_only_net_parent_and_nets_shared_child_once():
    result = plan(
        [
            item(
                "A", "MAKE", "2", [dict(item_id="B", quantity="2"), dict(item_id="C", quantity="1")]
            ),
            item("B", "MAKE", "1", [dict(item_id="C", quantity="3")]),
            item("C", stock="5"),
        ],
        [flow("A", 5)],
    )
    assert [(p["item_id"], p["quantity"]) for p in result["proposals"]] == [
        ("A", "3"),
        ("B", "5"),
        ("C", "13"),
    ]
    assert result["items"][2]["gross_requirement"] == "18"
    assert result["items"][2]["level"] == 2


def test_rounded_parent_output_drives_components_and_decimal_math():
    result = plan(
        [
            item("A", "MAKE", components=[dict(item_id="B", quantity="0.1")], order_multiple="3"),
            item("B"),
        ],
        [flow("A", 2)],
    )
    assert result["proposals"][0]["quantity"] == "3"
    assert result["proposals"][1]["quantity"] == "0.3"


def test_rounding_and_safety_floor_not_repeated_consumption():
    result = plan(
        [item("A", stock="2", safety_stock="3", minimum_order="5", order_multiple="4")],
        [flow("A", 1), flow("A", 1, "2026-09-21", "d2")],
    )
    assert [p["quantity"] for p in result["proposals"]] == ["8"]
    assert result["items"][0]["projected_end"] == "8"


def test_late_supply_never_covers_earlier_demand():
    result = plan([item("A")], [flow("A", 10)], [flow("A", 10, "2026-09-21", "po1")])
    assert result["proposals"][0]["quantity"] == "10"
    assert result["items"][0]["projected_end"] == "10"


def test_overdue_supply_is_exception_not_stock():
    result = plan([item("A")], [flow("A", 10)], [flow("A", 10, "2026-09-14", "po1")])
    assert result["proposals"][0]["quantity"] == "10"
    assert result["exceptions"][0]["code"] == "OVERDUE_SUPPLY"


def test_same_day_receipts_cover_demand():
    assert plan([item("A")], [flow("A", 10)], [flow("A", 10, ref="po1")])["proposals"] == []


def test_release_offset_drives_component_due_date_and_lateness():
    result = plan(
        [item("A", "MAKE", components=[dict(item_id="B", quantity="1")], lead_days=10), item("B")],
        [flow("A", 1)],
    )
    assert result["proposals"][0]["release_date"] == "2026-09-10"
    assert result["proposals"][0]["expedite"] is True
    assert result["proposals"][1]["reasons"][0]["date"] == "2026-09-10"


def test_duplicate_components_are_aggregated():
    result = plan(
        [
            item(
                "A",
                "MAKE",
                components=[dict(item_id="B", quantity="2"), dict(item_id="B", quantity="3")],
            ),
            item("B"),
        ],
        [flow("A", 2)],
    )
    assert result["proposals"][1]["quantity"] == "10"


@pytest.mark.parametrize(
    "items,demands",
    [
        ([item("A"), item("A")], []),
        ([item("A", "MAKE")], []),
        ([item("A", "MAKE", components=[dict(item_id="B", quantity="1")])], []),
        ([item("A", "MAKE", components=[dict(item_id="A", quantity="1")])], []),
        (
            [
                item("A", "MAKE", components=[dict(item_id="B", quantity="1")]),
                item("B", "MAKE", components=[dict(item_id="A", quantity="1")]),
            ],
            [],
        ),
        ([item("A")], [flow("X", 1)]),
        ([item("A")], [flow("A", 1), flow("A", 2)]),
        ([item("A", components=[dict(item_id="B", quantity="1")]), item("B")], []),
    ],
)
def test_invalid_graph_and_inputs_fail_closed(items, demands):
    with pytest.raises(ValueError):
        plan(items, demands)


def test_horizon_excludes_later_demand():
    assert not plan([item("A")], [flow("A", 3, "2027-01-01")])["proposals"]


def test_repeatable_and_does_not_mutate_request():
    request = MrpRequest.model_validate(
        dict(
            version="pulsar.mrp.v1",
            as_of="2026-09-15",
            horizon_end="2026-10-15",
            items=[item("A")],
            demands=[flow("A", "0.123")],
            supplies=[],
        )
    )
    original = deepcopy(request)
    assert calculate_mrp(request) == calculate_mrp(request)
    assert original == request


@pytest.mark.parametrize("quantity", ["-1", "0", "NaN", "Infinity", "0.0001", "1000000001"])
def test_reject_invalid_demand_quantities(quantity):
    with pytest.raises(ValueError):
        plan([item("A")], [flow("A", quantity)])


def test_empty_plan_is_well_formed():
    assert plan([])["items"] == []


def test_graph_and_explosion_resource_limits(monkeypatch):
    from planiadvance_v2.domain import mrp

    data = [item("A", "MAKE", components=[dict(item_id="B", quantity="1")]), item("B")]
    monkeypatch.setattr(mrp, "MAX_BOM_EDGES", 0)
    with pytest.raises(ValueError, match="edge limit"):
        plan(data)
    monkeypatch.setattr(mrp, "MAX_BOM_EDGES", 20_000)
    monkeypatch.setattr(mrp, "MAX_EXPLODED_REQUIREMENTS", 0)
    with pytest.raises(ValueError, match="explosion too large"):
        plan(data, [flow("A", 1)])
