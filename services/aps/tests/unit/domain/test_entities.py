"""Unit tests for domain entities."""

from __future__ import annotations

from datetime import datetime

import pytest

from planiadvance_v2.domain.entities import Machine, Operation, WorkOrder
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.value_objects import Duration, Priority


def _op(op_id: str, wo_id: str, seq: int = 1) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=seq,
        name=op_id,
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
    )


class TestOperation:
    def test_valid(self) -> None:
        op = _op("OP1", "WO1")
        assert op.total_processing_time.minutes == 60

    def test_self_dependency_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=10),
                eligible_machine_ids=["M1"],
                dependencies=["OP1"],
            )

    def test_empty_eligible_machines_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=10),
                eligible_machine_ids=[],
            )

    def test_zero_duration_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=0),
                eligible_machine_ids=["M1"],
            )


class TestWorkOrder:
    def test_valid(self) -> None:
        wo = WorkOrder(
            id="WO1",
            name="Test",
            product_id="P1",
            quantity=1,
            release_date=datetime(2026, 1, 1),
            due_date=datetime(2026, 1, 10),
            operations=[_op("OP1", "WO1", seq=1)],
            priority=Priority.HIGH,
        )
        assert wo.operation_ids() == {"OP1"}

    def test_due_before_release_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WorkOrder(
                id="WO1",
                name="x",
                product_id="P",
                quantity=1,
                release_date=datetime(2026, 1, 10),
                due_date=datetime(2026, 1, 5),
                operations=[_op("OP1", "WO1")],
            )

    def test_duplicate_op_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WorkOrder(
                id="WO1",
                name="x",
                product_id="P",
                quantity=1,
                release_date=datetime(2026, 1, 1),
                due_date=datetime(2026, 1, 10),
                operations=[
                    _op("OP1", "WO1", seq=1),
                    _op("OP1", "WO1", seq=2),
                ],
            )

    def test_operation_wrong_parent_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WorkOrder(
                id="WO1",
                name="x",
                product_id="P",
                quantity=1,
                release_date=datetime(2026, 1, 1),
                due_date=datetime(2026, 1, 10),
                operations=[_op("OP1", "WO2")],
            )


class TestMachine:
    def test_valid(self) -> None:
        m = Machine(id="M1", name="M1", calendar_id="CAL")
        assert m.efficiency == 1.0

    def test_zero_efficiency_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Machine(id="M1", name="M1", calendar_id="CAL", efficiency=0)
