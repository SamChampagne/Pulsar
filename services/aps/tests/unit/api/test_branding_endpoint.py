"""J5 — public branding endpoint tests."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.main import create_app
from planiadvance_v2.config import get_settings


@pytest.fixture(autouse=True)
def _reset_brand_env():
    keys = ("BRAND_NAME", "BRAND_SHORT_NAME", "BRAND_TAGLINE")
    saved = {k: os.environ.get(k) for k in keys}
    for k in keys:
        os.environ.pop(k, None)
    get_settings.cache_clear()
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    get_settings.cache_clear()


def test_branding_returns_defaults_when_env_unset() -> None:
    client = TestClient(create_app())
    response = client.get("/branding")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "PlaniAdvance"
    assert body["short_name"] == "PA"
    assert "Industrial" in body["tagline"]


def test_branding_reflects_env_overrides() -> None:
    os.environ["BRAND_NAME"] = "Sanimarc Plan"
    os.environ["BRAND_SHORT_NAME"] = "SM"
    os.environ["BRAND_TAGLINE"] = "Custom tagline for the pilot."
    get_settings.cache_clear()

    client = TestClient(create_app())
    response = client.get("/branding")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Sanimarc Plan"
    assert body["short_name"] == "SM"
    assert body["tagline"] == "Custom tagline for the pilot."


def test_branding_exposes_studio_v2_feature_flag_default_on() -> None:
    """Phase 8 slice C: studio_v2 ships ON by default for V1.0.

    The /branding endpoint must expose feature flags so the UI can
    branch without an extra round-trip.
    """
    client = TestClient(create_app())
    response = client.get("/branding")

    assert response.status_code == 200
    body = response.json()
    assert body.get("features", {}).get("studio_v2") is True


def test_branding_exposes_studio_v2_feature_flag_when_explicitly_disabled() -> None:
    """A pilot can still opt out by setting STUDIO_V2_ENABLED=false."""
    os.environ["STUDIO_V2_ENABLED"] = "false"
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        response = client.get("/branding")

        assert response.status_code == 200
        body = response.json()
        assert body.get("features", {}).get("studio_v2") is False
    finally:
        os.environ.pop("STUDIO_V2_ENABLED", None)
        get_settings.cache_clear()
