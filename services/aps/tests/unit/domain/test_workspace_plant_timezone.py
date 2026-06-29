"""V1.2 P2.4b — Workspace.plant_timezone domain validation.

P2.4 fixed the DISPLAY side (naive ISOs render verbatim under any
browser TZ — see lib/wallClock.ts). The symmetric gap on the EDIT
side: when a planner in Toronto drags a Gantt bar to "10:00" but
the plant is in Mumbai, the browser-local Date needs to be
re-interpreted in the plant TZ before being serialised as a naive
ISO. ``Workspace.plant_timezone`` is the source of truth for that
conversion.

These tests pin the contract on the domain entity itself: invalid
IANA zones must be rejected at construction so a typo never leaks
into the wallClock layer and silently falls back to UTC.
"""

from __future__ import annotations

import pytest

from planiadvance_v2.domain.entities import Workspace
from planiadvance_v2.domain.errors import ValidationError


def test_default_plant_timezone_is_utc() -> None:
    """Legacy single-region workspaces created without an explicit
    plant_timezone must behave exactly like before — UTC means the
    wallClock layer's "format the naive components verbatim"
    semantics still apply. A regression that changed the default
    would silently shift every existing pilot's bars."""

    workspace = Workspace(id="default", name="Default")

    assert workspace.plant_timezone == "UTC"


def test_valid_iana_timezone_is_accepted() -> None:
    """Multi-region pilots set a real IANA zone. Toronto is the
    Sanimarc reference plant and a useful sanity case (DST-aware
    zone, not just a fixed offset)."""

    workspace = Workspace(
        id="plant-mtl",
        name="Montréal plant",
        plant_timezone="America/Toronto",
    )

    assert workspace.plant_timezone == "America/Toronto"


def test_typo_in_timezone_raises_validation_error() -> None:
    """The whole point of constructor-time validation is to catch
    "America/Tornoto" before it reaches the wallClock layer (which
    would fall back to UTC and silently shift edits). The error
    message must name the bad input so the operator can fix it
    without guessing."""

    with pytest.raises(ValidationError) as exc_info:
        Workspace(
            id="plant-bug",
            name="Buggy plant",
            plant_timezone="America/Tornoto",
        )

    assert "America/Tornoto" in str(exc_info.value)


def test_empty_string_timezone_is_rejected() -> None:
    """An empty string is a common UI-layer bug (e.g. a Settings
    page that sends "" when the planner clears the field). It must
    fail loudly at the domain boundary, not silently become a
    fallback to whatever ZoneInfo("") happens to do."""

    with pytest.raises(ValidationError):
        Workspace(id="plant-empty", name="Empty TZ", plant_timezone="")


def test_utc_is_always_accepted() -> None:
    """UTC must work on every platform — it's the legacy default
    and a test sentinel. A regression that lost it would mass-break
    every existing workspace."""

    workspace = Workspace(id="utc-plant", name="UTC plant", plant_timezone="UTC")

    assert workspace.plant_timezone == "UTC"
