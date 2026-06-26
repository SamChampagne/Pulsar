"""Tests for advanced domain field persistence (setup matrix, maintenance, preemption).

These tests verify that the repository serialization/deserialization
round-trips correctly for all new Machine and Operation fields, without
needing a real database (they test the converter methods directly).
"""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.domain.entities import Machine, Resource
from planiadvance_v2.domain.value_objects import SetupMatrix, TimeWindow
from planiadvance_v2.infrastructure.db.repositories.machine_repository import (
    SqlMachineRepository,
)

# --------------------------------------------------------------------------
# Setup matrix JSON serialization
# --------------------------------------------------------------------------


class TestSetupMatrixSerialization:
    def test_none_matrix_roundtrips(self):
        assert SqlMachineRepository._setup_matrix_to_json(None) is None
        assert SqlMachineRepository._setup_matrix_from_json("M1", None) is None

    def test_empty_matrix_roundtrips(self):
        matrix = SetupMatrix(machine_id="M1", default_minutes=5, initial_minutes=2)
        data = SqlMachineRepository._setup_matrix_to_json(matrix)
        assert data["default_minutes"] == 5
        assert data["initial_minutes"] == 2
        assert data["transitions"] == []

        restored = SqlMachineRepository._setup_matrix_from_json("M1", data)
        assert restored is not None
        assert restored.machine_id == "M1"
        assert restored.default_minutes == 5
        assert restored.initial_minutes == 2
        assert restored.transitions == {}

    def test_matrix_with_transitions_roundtrips(self):
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=10,
            initial_minutes=3,
            transitions={("A", "B"): 15, ("B", "A"): 20, ("A", "A"): 0},
        )
        data = SqlMachineRepository._setup_matrix_to_json(matrix)
        restored = SqlMachineRepository._setup_matrix_from_json("M1", data)
        assert restored is not None
        assert restored.get("A", "B") == 15
        assert restored.get("B", "A") == 20
        assert restored.get("A", "A") == 0
        assert restored.get("X", "Y") == 10  # default

    def test_uniform_matrix_roundtrips(self):
        matrix = SetupMatrix.uniform("M2", 7)
        data = SqlMachineRepository._setup_matrix_to_json(matrix)
        restored = SqlMachineRepository._setup_matrix_from_json("M2", data)
        assert restored is not None
        assert restored.default_minutes == 7
        assert restored.initial_minutes == 7


# --------------------------------------------------------------------------
# Maintenance windows JSON serialization
# --------------------------------------------------------------------------


class TestMaintenanceWindowSerialization:
    def test_empty_windows_roundtrips(self):
        assert SqlMachineRepository._maintenance_to_json([]) is None
        assert SqlMachineRepository._maintenance_from_json(None) == []
        assert SqlMachineRepository._maintenance_from_json([]) == []

    def test_windows_roundtrip(self):
        windows = [
            TimeWindow(
                start=datetime(2026, 3, 10, 8, 0),
                end=datetime(2026, 3, 10, 12, 0),
            ),
            TimeWindow(
                start=datetime(2026, 3, 15, 6, 0),
                end=datetime(2026, 3, 15, 18, 0),
            ),
        ]
        data = SqlMachineRepository._maintenance_to_json(windows)
        assert len(data) == 2

        restored = SqlMachineRepository._maintenance_from_json(data)
        assert len(restored) == 2
        assert restored[0].start == datetime(2026, 3, 10, 8, 0)
        assert restored[0].end == datetime(2026, 3, 10, 12, 0)
        assert restored[1].start == datetime(2026, 3, 15, 6, 0)

    def test_iso_format_used(self):
        windows = [
            TimeWindow(
                start=datetime(2026, 1, 1, 0, 0),
                end=datetime(2026, 1, 2, 0, 0),
            ),
        ]
        data = SqlMachineRepository._maintenance_to_json(windows)
        assert "2026-01-01" in data[0]["start"]
        assert "2026-01-02" in data[0]["end"]


# --------------------------------------------------------------------------
# Machine domain construction with advanced fields
# --------------------------------------------------------------------------


class TestMachineDomainFields:
    def test_machine_with_setup_matrix(self):
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=5,
            transitions={("steel", "aluminium"): 30},
        )
        m = Machine(
            id="M1", name="CNC-1", calendar_id="CAL", setup_matrix=matrix
        )
        assert m.setup_matrix is not None
        assert m.setup_matrix.get("steel", "aluminium") == 30
        assert m.setup_matrix.get("aluminium", "steel") == 5  # default

    def test_machine_with_maintenance_windows(self):
        m = Machine(
            id="M1",
            name="CNC-1",
            calendar_id="CAL",
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 3, 10, 8, 0),
                    end=datetime(2026, 3, 10, 12, 0),
                )
            ],
        )
        assert len(m.maintenance_windows) == 1
        assert m.maintenance_windows[0].duration.minutes == 240


# --------------------------------------------------------------------------
# Resource domain construction
# --------------------------------------------------------------------------


class TestResourceDomain:
    def test_basic_resource(self):
        r = Resource(id="OP-POOL", name="Operators", capacity=3)
        assert r.capacity == 3
        assert r.calendar_id is None
        assert r.tags == []

    def test_resource_with_tags(self):
        r = Resource(
            id="WELDER",
            name="Welding Station",
            capacity=1,
            calendar_id="CAL",
            tags=["welding", "certified"],
        )
        assert r.has_tag("welding")
        assert not r.has_tag("painting")

    def test_resource_capacity_validation(self):
        import pytest

        from planiadvance_v2.domain.errors import ValidationError

        with pytest.raises(ValidationError):
            Resource(id="BAD", name="Bad", capacity=0)

        with pytest.raises(ValidationError):
            Resource(id="BAD", name="Bad", capacity=-1)
