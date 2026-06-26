from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from planiadvance_v2.api.dependencies import get_db_session
from planiadvance_v2.api.main import create_app
from planiadvance_v2.infrastructure.db import models  # noqa: F401
from planiadvance_v2.infrastructure.db.base import Base


def _api():
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
    return app


class TestMaterialCrudApi:
    def test_inventory_crud_round_trip(self):
        app = _api()
        with TestClient(app) as client:
            created = client.post(
                "/inventory",
                json={
                    "material_id": "RAW-ALUMINUM",
                    "quantity_on_hand": 12.5,
                    "as_of": "2026-01-05T08:00:00",
                },
            )
            fetched = client.get("/inventory/RAW-ALUMINUM")
            listed = client.get("/inventory")

        assert created.status_code == 201
        assert fetched.status_code == 200
        assert listed.status_code == 200
        assert fetched.json()["quantity_on_hand"] == 12.5
        assert listed.json()[0]["material_id"] == "RAW-ALUMINUM"

    def test_supply_crud_round_trip(self):
        app = _api()
        with TestClient(app) as client:
            created = client.post(
                "/supplies",
                json={
                    "id": "SUP-AL-001",
                    "material_id": "RAW-ALUMINUM",
                    "quantity": 20.0,
                    "available_at": "2026-01-05T14:00:00",
                    "source_type": "purchase_order",
                },
            )
            fetched = client.get("/supplies/SUP-AL-001")
            listed = client.get("/supplies")

        assert created.status_code == 201
        assert fetched.status_code == 200
        assert listed.status_code == 200
        assert fetched.json()["source_type"] == "purchase_order"
        assert listed.json()[0]["id"] == "SUP-AL-001"
