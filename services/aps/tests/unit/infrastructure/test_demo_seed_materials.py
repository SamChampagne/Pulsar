from __future__ import annotations

from planiadvance_v2.infrastructure.seed import build_demo_dataset


def test_demo_dataset_includes_material_inventory_and_supplies() -> None:
    dataset = build_demo_dataset()

    assert dataset.inventory_items
    assert dataset.supplies
    assert any(
        op.material_requirements
        for work_order in dataset.work_orders
        for op in work_order.operations
    )
