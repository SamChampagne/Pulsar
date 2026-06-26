"""Tests for the `minimal` seed dataset used by the pilot bundle.

A pilot install must boot with a valid schema and a tenant fixture but
zero operational data — the operator imports their own machines / work
orders through `/integration` or the Integration Studio.
"""

from __future__ import annotations

import pytest

from planiadvance_v2.infrastructure.seed import (
    build_minimal_demo_dataset,
    build_seed_dataset,
)


def test_build_minimal_demo_dataset_is_operationally_empty() -> None:
    dataset = build_minimal_demo_dataset()

    assert dataset.name == "minimal"
    assert dataset.calendars == []
    assert dataset.machines == []
    assert dataset.resources == []
    assert dataset.work_orders == []
    assert dataset.inventory_items == []
    assert dataset.supplies == []
    # horizon_start should be a real datetime so downstream code that
    # falls back to it does not blow up.
    assert dataset.horizon_start is not None


@pytest.mark.parametrize("alias", ["minimal", "empty", "none", "pilot", "MINIMAL"])
def test_build_seed_dataset_routes_aliases_to_minimal(alias: str) -> None:
    dataset = build_seed_dataset(alias)

    assert dataset.name == "minimal"
    assert dataset.machines == []
    assert dataset.work_orders == []


def test_build_seed_dataset_unknown_name_lists_minimal_in_error() -> None:
    with pytest.raises(ValueError) as exc:
        build_seed_dataset("does-not-exist")

    assert "minimal" in str(exc.value)
