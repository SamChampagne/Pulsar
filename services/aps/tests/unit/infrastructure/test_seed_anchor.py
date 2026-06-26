"""Tests for the seed-dataset anchor helper.

The reference factories hard-code 2026-01-05 dates. When a pilot is
booted four months later, the dashboard shows every WO as months past
due. `anchor_demo_dataset` shifts the whole dataset by a delta so the
operator sees a current-looking workshop without test datasets losing
their determinism.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.infrastructure.seed import (
    anchor_demo_dataset,
    build_industrial_demo_dataset,
    next_monday_eight_am,
)


def test_anchor_shifts_horizon_by_delta() -> None:
    dataset = build_industrial_demo_dataset()
    target = dataset.horizon_start + timedelta(days=120)

    shifted = anchor_demo_dataset(dataset, target)

    assert shifted.horizon_start == target


def test_anchor_shifts_every_work_order_due_and_release_date() -> None:
    dataset = build_industrial_demo_dataset()
    target = dataset.horizon_start + timedelta(days=120)

    shifted = anchor_demo_dataset(dataset, target)

    delta = timedelta(days=120)
    for original, moved in zip(dataset.work_orders, shifted.work_orders, strict=True):
        assert moved.due_date == original.due_date + delta
        assert moved.release_date == original.release_date + delta


def test_anchor_shifts_supply_lots_and_inventory_as_of() -> None:
    dataset = build_industrial_demo_dataset()
    target = dataset.horizon_start + timedelta(days=42)

    shifted = anchor_demo_dataset(dataset, target)

    delta = timedelta(days=42)
    for original, moved in zip(dataset.supplies, shifted.supplies, strict=True):
        assert moved.available_at == original.available_at + delta
    for original, moved in zip(
        dataset.inventory_items, shifted.inventory_items, strict=True
    ):
        if original.as_of is None:
            assert moved.as_of is None
        else:
            assert moved.as_of == original.as_of + delta


def test_anchor_with_zero_delta_returns_original() -> None:
    dataset = build_industrial_demo_dataset()
    shifted = anchor_demo_dataset(dataset, dataset.horizon_start)

    # Same horizon and same WO due dates — original is fine to reuse.
    assert shifted.horizon_start == dataset.horizon_start
    for a, b in zip(dataset.work_orders, shifted.work_orders, strict=True):
        assert a.due_date == b.due_date


def test_next_monday_eight_am_returns_a_monday_at_eight() -> None:
    # Run from a known Wednesday — should jump forward to the following Monday.
    wed = datetime(2026, 5, 6, 14, 30, 0)
    monday = next_monday_eight_am(wed)

    assert monday.weekday() == 0  # Monday
    assert monday.hour == 8 and monday.minute == 0
    assert monday.date() == (wed.date() + timedelta(days=5))


def test_next_monday_eight_am_skips_today_when_already_past_eight() -> None:
    # Running on Monday after 08:00 — must jump to next week so all
    # operations land in the future.
    monday_afternoon = datetime(2026, 5, 11, 13, 0, 0)
    target = next_monday_eight_am(monday_afternoon)

    # We can't easily compare to "now" inside the test (the helper has a
    # branch keyed off real datetime.now() when reference is in the
    # past). The contract is the helper returns a Monday at 08:00 on or
    # AFTER `reference`.
    assert target.weekday() == 0
    assert target.hour == 8
    assert target >= monday_afternoon
