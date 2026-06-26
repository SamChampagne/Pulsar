from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import get_create_workspace, get_list_workspaces
from planiadvance_v2.api.main import create_app
from planiadvance_v2.application.use_cases import CreateWorkspace, ListWorkspaces
from planiadvance_v2.infrastructure.in_memory import InMemoryWorkspaceRepository


@pytest.fixture
def api():
    repository = InMemoryWorkspaceRepository()
    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_create_workspace] = lambda: CreateWorkspace(repository)
    app.dependency_overrides[get_list_workspaces] = lambda: ListWorkspaces(repository)

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_list_workspaces_returns_default_workspace(api: TestClient):
    response = api.get("/workspaces")

    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == "default"
    assert data[0]["is_default"] is True


def test_create_workspace_is_returned_by_listing(api: TestClient):
    create_response = api.post(
        "/workspaces",
        json={
          "id": "plant-east",
          "name": "Plant East",
          "description": "East plant planners",
          "is_default": False,
          "is_active": True,
        },
    )

    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["id"] == "plant-east"
    # V1.2 P2.4b — every workspace surfaces a plant_timezone. The
    # default UTC behaviour is the contract for legacy clients that
    # don't send the field; a future Settings UI sets it per plant.
    assert payload["plant_timezone"] == "UTC"

    list_response = api.get("/workspaces")
    ids = {item["id"] for item in list_response.json()}
    assert "plant-east" in ids


def test_create_workspace_with_plant_timezone(api: TestClient) -> None:
    """Multi-region pilot path: the planner Settings UI sends a
    real IANA zone and the API persists it through the use case.
    The GET response must round-trip the field so the UI can render
    "configured TZ" badges next to bars."""

    create = api.post(
        "/workspaces",
        json={
            "id": "plant-mtl",
            "name": "Montréal",
            "plant_timezone": "America/Toronto",
        },
    )

    assert create.status_code == 201
    assert create.json()["plant_timezone"] == "America/Toronto"

    fetched = api.get("/workspaces")
    montreal = next(w for w in fetched.json() if w["id"] == "plant-mtl")
    assert montreal["plant_timezone"] == "America/Toronto"


def test_create_workspace_with_invalid_timezone_returns_422(
    api: TestClient,
) -> None:
    """A typo like ``America/Tornoto`` must NOT silently fall back
    to UTC — that's how a planner discovers months later that every
    edit was off by 5 hours. The constructor-level ValidationError
    is mapped to a 422 with a field-level message the UI can flag."""

    response = api.post(
        "/workspaces",
        json={
            "id": "plant-typo",
            "name": "Typo plant",
            "plant_timezone": "America/Tornoto",
        },
    )

    assert response.status_code == 422
    body = response.json()
    # Maps through the global ValidationError → validation_error
    # handler, same shape as every other constructor-validated
    # entity. The message must still name the bad value so the UI
    # can highlight the right field.
    assert body["error"] == "validation_error"
    assert "America/Tornoto" in body["message"]
