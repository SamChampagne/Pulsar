"""Tests for advanced API schema validation.

Verify that the new schema fields (setup_family, preemptible, min_chunk,
setup_matrix, maintenance_windows, resources) serialize and validate
correctly.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from pydantic import ValidationError

from planiadvance_v2.api.schemas import (
    MachineIn,
    MaintenanceWindowIn,
    OperationIn,
    ResourceIn,
    SetupMatrixIn,
    SetupTransitionIn,
)

# --------------------------------------------------------------------------
# OperationIn advanced fields
# --------------------------------------------------------------------------


class TestOperationInAdvanced:
    def test_defaults(self):
        op = OperationIn(
            id="OP1",
            sequence=1,
            name="Cut",
            duration_minutes=60,
            eligible_machine_ids=["M1"],
        )
        assert op.setup_family is None
        assert op.preemptible is False
        assert op.min_chunk_minutes == 0

    def test_with_setup_family(self):
        op = OperationIn(
            id="OP1",
            sequence=1,
            name="Paint",
            duration_minutes=120,
            eligible_machine_ids=["M1"],
            setup_family="colour_red",
        )
        assert op.setup_family == "colour_red"

    def test_with_preemption(self):
        op = OperationIn(
            id="OP1",
            sequence=1,
            name="Long Job",
            duration_minutes=480,
            eligible_machine_ids=["M1"],
            preemptible=True,
            min_chunk_minutes=60,
        )
        assert op.preemptible is True
        assert op.min_chunk_minutes == 60

    def test_min_chunk_validation(self):
        with pytest.raises(ValidationError):
            OperationIn(
                id="OP1",
                sequence=1,
                name="Bad",
                duration_minutes=60,
                eligible_machine_ids=["M1"],
                min_chunk_minutes=-1,
            )


# --------------------------------------------------------------------------
# MachineIn advanced fields
# --------------------------------------------------------------------------


class TestMachineInAdvanced:
    def test_defaults(self):
        m = MachineIn(id="M1", name="CNC", calendar_id="CAL")
        assert m.setup_matrix is None
        assert m.maintenance_windows == []

    def test_with_setup_matrix(self):
        m = MachineIn(
            id="M1",
            name="CNC",
            calendar_id="CAL",
            setup_matrix=SetupMatrixIn(
                default_minutes=10,
                initial_minutes=5,
                transitions=[
                    SetupTransitionIn(**{"from": "steel", "to": "aluminium", "minutes": 30})
                ],
            ),
        )
        assert m.setup_matrix is not None
        assert m.setup_matrix.default_minutes == 10
        assert len(m.setup_matrix.transitions) == 1
        assert m.setup_matrix.transitions[0].from_family == "steel"

    def test_with_maintenance_windows(self):
        m = MachineIn(
            id="M1",
            name="CNC",
            calendar_id="CAL",
            maintenance_windows=[
                MaintenanceWindowIn(
                    start=datetime(2026, 3, 10, 8, 0),
                    end=datetime(2026, 3, 10, 12, 0),
                ),
            ],
        )
        assert len(m.maintenance_windows) == 1


# --------------------------------------------------------------------------
# ResourceIn
# --------------------------------------------------------------------------


class TestResourceIn:
    def test_basic(self):
        r = ResourceIn(id="R1", name="Operators", capacity=3)
        assert r.capacity == 3
        assert r.calendar_id is None
        assert r.tags == []

    def test_with_tags(self):
        r = ResourceIn(
            id="R1", name="Welders", capacity=2, tags=["certified"]
        )
        assert r.tags == ["certified"]

    def test_capacity_validation(self):
        with pytest.raises(ValidationError):
            ResourceIn(id="R1", name="Bad", capacity=0)

        with pytest.raises(ValidationError):
            ResourceIn(id="R1", name="Bad", capacity=-1)
