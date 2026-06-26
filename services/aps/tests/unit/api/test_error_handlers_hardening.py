"""J7 hardening tests for the API error handlers.

The catch-all 500 must NOT leak the Python exception type/message to the
HTTP client — only a generic message + a request id the operator can
grep against the server logs.
"""

from __future__ import annotations

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.error_handlers import register_error_handlers


@pytest.fixture
def app_with_handlers() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/__test__/raise-key-error")
    async def _raise() -> None:
        raise KeyError("super_secret_table.column_name")

    @app.get("/__test__/raise-attr")
    async def _raise_attr() -> None:
        raise AttributeError("private/internal/path/to/module.py")

    return app


def test_unhandled_500_does_not_leak_exception_type_to_response(
    app_with_handlers: FastAPI,
) -> None:
    client = TestClient(app_with_handlers, raise_server_exceptions=False)

    response = client.get("/__test__/raise-key-error")

    assert response.status_code == 500
    body = response.json()
    assert body["error"] == "internal_server_error"
    # The exception type/message must not appear anywhere in the body.
    serialised = response.text
    assert "KeyError" not in serialised
    assert "super_secret_table" not in serialised
    assert "column_name" not in serialised


def test_unhandled_500_includes_a_request_reference(
    app_with_handlers: FastAPI,
) -> None:
    client = TestClient(app_with_handlers, raise_server_exceptions=False)

    response = client.get("/__test__/raise-attr")

    assert response.status_code == 500
    message = response.json()["message"]
    # The reference is meant to be greppable in the server log; it should
    # be a short opaque token, not a UUID with hyphens that's awkward to
    # type. We assert "Reference:" never gets coupled to internal paths.
    assert "private/internal/path/to/module.py" not in message
    assert "AttributeError" not in message
    assert "support:" in message
    # Reference is the last whitespace-separated token; it should look
    # like a short hex string we can find in logs.
    reference = message.rsplit(" ", 1)[-1]
    assert re.fullmatch(r"[0-9a-f]{6,16}", reference)


def test_two_consecutive_500s_get_distinct_request_ids(
    app_with_handlers: FastAPI,
) -> None:
    client = TestClient(app_with_handlers, raise_server_exceptions=False)

    first = client.get("/__test__/raise-key-error").json()["message"]
    second = client.get("/__test__/raise-key-error").json()["message"]

    first_ref = first.rsplit(" ", 1)[-1]
    second_ref = second.rsplit(" ", 1)[-1]
    assert first_ref != second_ref
