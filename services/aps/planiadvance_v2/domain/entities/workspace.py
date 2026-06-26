"""Workspace entity: logical container for planning scenarios and runs."""

from __future__ import annotations

from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..errors import ValidationError


@dataclass(slots=True)
class Workspace:
    id: str
    name: str
    description: str = ""
    organization_id: str | None = None
    is_default: bool = False
    is_active: bool = True
    # V1.2 P2.4b — IANA timezone the plant operates in (e.g.
    # "America/Toronto", "Asia/Kolkata"). Drives the conversion
    # browser-local Date → naive ISO on the EDIT side so a planner
    # accessing the Gantt from a different region than the plant
    # doesn't silently shift bars by the TZ delta. P2.4 already
    # fixed display (naive ISOs render verbatim); this closes the
    # symmetric gap on writes. Default ``UTC`` is the safest no-op:
    # legacy single-region workspaces behave exactly like before.
    plant_timezone: str = "UTC"

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Workspace.id is required")
        if not self.name:
            raise ValidationError("Workspace.name is required")
        # Reject unknown IANA zones at construction time so a typo
        # ("America/Tornoto") doesn't silently fall back to UTC at
        # runtime and break planner edits months later.
        if not self.plant_timezone or not self.plant_timezone.strip():
            raise ValidationError(
                "Workspace.plant_timezone cannot be empty "
                "(use 'UTC' for the legacy single-region default)."
            )
        try:
            ZoneInfo(self.plant_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValidationError(
                f"Workspace.plant_timezone {self.plant_timezone!r} is not a "
                "valid IANA timezone (e.g. 'America/Toronto', 'UTC')."
            ) from exc
