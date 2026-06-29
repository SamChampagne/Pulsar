from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from planiadvance_v2.api.dependencies import get_db_session
from planiadvance_v2.api.main import create_app
from planiadvance_v2.infrastructure.db import models  # noqa: F401
from planiadvance_v2.infrastructure.db.base import Base


@pytest.fixture
def api():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    def _db_override():
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_db_session] = _db_override

    with TestClient(app) as client:
        yield {"client": client}

    app.dependency_overrides.clear()


class TestCrudReadModels:
    def test_machine_read_model_includes_setup_and_maintenance(self, api):
        calendar = api["client"].post(
            "/calendars",
            json={
                "id": "CAL-REF",
                "name": "Mon-Fri 08-17",
                "shifts": [{"weekday": 0, "start": "08:00", "end": "17:00"}],
            },
        )
        assert calendar.status_code == 201

        created = api["client"].post(
            "/machines",
            json={
                "id": "ASM-1",
                "name": "Assembly Cell 1",
                "calendar_id": "CAL-REF",
                "capabilities": ["assembly"],
                "efficiency": 1.0,
                "setup_matrix": {
                    "default_minutes": 20,
                    "initial_minutes": 10,
                    "transitions": [
                        {"from": "RED", "to": "BLUE", "minutes": 35},
                        {"from": "BLUE", "to": "RED", "minutes": 25},
                    ],
                },
                "maintenance_windows": [
                    {
                        "start": "2026-01-05T13:00:00",
                        "end": "2026-01-05T15:00:00",
                    }
                ],
            },
        )

        assert created.status_code == 201
        machine = created.json()
        assert machine["has_setup_matrix"] is True
        assert machine["maintenance_window_count"] == 1
        assert machine["setup_matrix"]["default_minutes"] == 20
        assert len(machine["setup_matrix"]["transitions"]) == 2
        assert machine["maintenance_windows"][0]["start"] == "2026-01-05T13:00:00"

        listed = api["client"].get("/machines")
        assert listed.status_code == 200
        assert listed.json()[0]["setup_matrix"]["initial_minutes"] == 10

        fetched = api["client"].get("/machines/ASM-1")
        assert fetched.status_code == 200
        fetched_data = fetched.json()
        assert fetched_data["setup_matrix"]["transitions"][0]["minutes"] in {25, 35}
        assert fetched_data["maintenance_windows"][0]["end"] == "2026-01-05T15:00:00"

    def test_work_order_read_model_includes_lot_sizing_and_advanced_operations(self, api):
        calendar = api["client"].post(
            "/calendars",
            json={
                "id": "CAL-REF",
                "name": "Mon-Fri 08-17",
                "shifts": [{"weekday": 0, "start": "08:00", "end": "17:00"}],
            },
        )
        assert calendar.status_code == 201
        for machine_id in ("CUT-1", "ASM-1", "ASM-2"):
            response = api["client"].post(
                "/machines",
                json={
                    "id": machine_id,
                    "name": machine_id,
                    "calendar_id": "CAL-REF",
                },
            )
            assert response.status_code == 201
        resource = api["client"].post(
            "/resources",
            json={
                "id": "TOOL-KIT",
                "name": "Tool Kit",
                "capacity": 1,
                "tags": ["shared"],
            },
        )
        assert resource.status_code == 201

        created = api["client"].post(
            "/work-orders",
            json={
                "id": "WO-RED",
                "name": "WO-RED",
                "product_id": "P-RED",
                "quantity": 20,
                "due_date": "2026-01-06T18:00:00",
                "release_date": "2026-01-05T08:00:00",
                "priority": 1,
                "lot_sizing": {"mode": "fixed", "lot_size": 10},
                "operations": [
                    {
                        "id": "RED-CUT",
                        "sequence": 1,
                        "name": "RED-CUT",
                        "duration_minutes": 80,
                        "eligible_machine_ids": ["CUT-1"],
                    },
                    {
                        "id": "RED-ASM",
                        "sequence": 2,
                        "name": "RED-ASM",
                        "duration_minutes": 90,
                        "eligible_machine_ids": ["ASM-1", "ASM-2"],
                        "dependencies": ["RED-CUT"],
                        "setup_family": "RED",
                        "preemptible": True,
                        "min_chunk_minutes": 30,
                        "resource_requirements": [
                            {"resource_id": "TOOL-KIT", "units": 1}
                        ],
                        "routings": [
                            {
                                "machine_id": "ASM-1",
                                "duration_minutes": 90,
                                "setup_minutes": 15,
                                "resource_requirements": [
                                    {"resource_id": "TOOL-KIT", "units": 1}
                                ],
                            },
                            {
                                "machine_id": "ASM-2",
                                "duration_minutes": 110,
                                "setup_minutes": 5,
                                "resource_requirements": [],
                            },
                        ],
                    },
                ],
            },
        )

        assert created.status_code == 201
        work_order = created.json()
        assert work_order["lot_sizing"]["mode"] == "fixed"
        assert work_order["lot_sizing"]["lot_size"] == 10
        assert len(work_order["operations"]) == 2
        asm = next(op for op in work_order["operations"] if op["id"] == "RED-ASM")
        assert asm["setup_family"] == "RED"
        assert asm["preemptible"] is True
        assert asm["min_chunk_minutes"] == 30
        assert asm["resource_requirements"][0]["resource_id"] == "TOOL-KIT"
        assert len(asm["routings"]) == 2
        assert asm["routings"][0]["resource_requirements"][0]["units"] == 1

        listed = api["client"].get("/work-orders")
        assert listed.status_code == 200
        listed_wo = listed.json()[0]
        assert listed_wo["lot_sizing"]["mode"] == "fixed"
        assert len(listed_wo["operations"]) == 2

        fetched = api["client"].get("/work-orders/WO-RED")
        assert fetched.status_code == 200
        fetched_wo = fetched.json()
        fetched_asm = next(op for op in fetched_wo["operations"] if op["id"] == "RED-ASM")
        assert fetched_asm["dependencies"] == ["RED-CUT"]
        assert fetched_asm["routings"][1]["machine_id"] == "ASM-2"
