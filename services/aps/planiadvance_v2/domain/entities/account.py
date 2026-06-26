"""Account and tenant entities."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from ..errors import ValidationError


class MembershipRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    PLANNER = "planner"
    VIEWER = "viewer"
    INTEGRATOR = "integrator"


@dataclass(slots=True)
class Organization:
    id: str
    name: str
    slug: str
    is_active: bool = True

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Organization.id is required")
        if not self.name:
            raise ValidationError("Organization.name is required")
        if not self.slug:
            raise ValidationError("Organization.slug is required")


@dataclass(slots=True)
class UserAccount:
    id: str
    email: str
    display_name: str
    is_active: bool = True
    # bcrypt hash of the planner's password. None means the account
    # is still on the legacy selector-login flow (no real auth yet).
    # We never store the plaintext password and the field is omitted
    # from any /auth/me payload (see api/routes/auth.py _build_context).
    password_hash: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("UserAccount.id is required")
        if not self.email or "@" not in self.email:
            raise ValidationError("UserAccount.email must be a valid email")
        if not self.display_name:
            raise ValidationError("UserAccount.display_name is required")


@dataclass(slots=True)
class Membership:
    organization_id: str
    user_id: str
    role: MembershipRole
    is_active: bool = True

    def __post_init__(self) -> None:
        if not self.organization_id:
            raise ValidationError("Membership.organization_id is required")
        if not self.user_id:
            raise ValidationError("Membership.user_id is required")


@dataclass(slots=True)
class WorkspaceAccessGrant:
    organization_id: str
    workspace_id: str
    user_id: str
    is_active: bool = True

    def __post_init__(self) -> None:
        if not self.organization_id:
            raise ValidationError("WorkspaceAccessGrant.organization_id is required")
        if not self.workspace_id:
            raise ValidationError("WorkspaceAccessGrant.workspace_id is required")
        if not self.user_id:
            raise ValidationError("WorkspaceAccessGrant.user_id is required")
