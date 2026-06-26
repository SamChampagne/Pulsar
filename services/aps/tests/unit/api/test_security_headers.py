"""J7 hardening — security headers middleware."""

from __future__ import annotations

from fastapi.testclient import TestClient

from planiadvance_v2.api.main import create_app


def test_security_headers_applied_on_every_response() -> None:
    client = TestClient(create_app())
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_hsts_header_skipped_when_request_is_http() -> None:
    client = TestClient(create_app())
    response = client.get("/health")

    # The TestClient defaults to http://. HSTS must NOT pin from a
    # plain-HTTP request — that would lock out a dev install.
    assert "strict-transport-security" not in response.headers


def test_hsts_header_added_when_x_forwarded_proto_is_https() -> None:
    client = TestClient(create_app())
    response = client.get(
        "/health",
        headers={"X-Forwarded-Proto": "https"},
    )

    assert response.headers["strict-transport-security"].startswith("max-age=")


def test_routes_can_override_a_security_header() -> None:
    """A route that sets X-Frame-Options to its own value (e.g. an
    embeddable PDF preview) keeps that value — middleware uses
    setdefault so it never clobbers an upstream choice."""
    from fastapi import FastAPI

    from planiadvance_v2.api.security_headers import install_security_headers

    app = FastAPI()
    install_security_headers(app)

    @app.get("/embed")
    async def _embed():
        from fastapi.responses import Response

        return Response(content="ok", headers={"X-Frame-Options": "SAMEORIGIN"})

    response = TestClient(app).get("/embed")
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
