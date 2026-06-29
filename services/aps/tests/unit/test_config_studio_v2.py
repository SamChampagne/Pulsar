"""Phase 8 slice C — studio_v2 ships ON by default."""

from __future__ import annotations

from planiadvance_v2.config import Settings


def test_studio_v2_enabled_field_default_is_true():
    """V1.0 ship: Studio v2 is the default Studio. v1 stays as fallback.

    Reads the dataclass-level default rather than an instance, so
    .env / environment overrides don't mask a regression in the code.
    """
    field = Settings.model_fields["studio_v2_enabled"]
    assert field.default is True
