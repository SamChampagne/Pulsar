"""Current tenant context resolved from request headers.

This is a foundation, not a full auth stack. Downstream routes can read a
``TenantContext`` to scope reads/writes to an organization. When a user id
is also supplied, the membership is verified so that a user can only act
on organizations they belong to.

The actual identity source (API key, JWT, session, ERP token) will be
plugged in later - ``get_tenant_context`` is the single seam where that
resolution happens.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..application.ports import MembershipRepository, OrganizationRepository
from ..application.ports.revoked_auth_token_repository import (
    RevokedAuthTokenRepository,
)
from ..application.ports.user_session_revocation_repository import (
    UserSessionRevocationRepository,
)
from ..application.ports.workspace_repository import WorkspaceRepository
from ..application.use_cases import ListAccessibleWorkspaces
from ..config import get_settings
from ..domain.entities import MembershipRole
from ..infrastructure.db.repositories import (
    SqlMembershipRepository,
    SqlOrganizationRepository,
    SqlRevokedAuthTokenRepository,
    SqlUserSessionRevocationRepository,
    SqlWorkspaceRepository,
)
from .auth_sessions import (
    InvalidAuthSession,
    hash_auth_session_token,
    verify_auth_session,
)
from .dependencies import get_db_session, get_list_accessible_workspaces


@dataclass(slots=True)
class TenantContext:
    """Who is acting, and on whose behalf.

    Both fields are optional so unauthenticated local development keeps
    working. When ``organization_id`` is set, the organization has been
    validated. When ``user_id`` is set with an ``organization_id``,
    membership has been validated and ``role`` reflects that membership.
    """

    organization_id: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None
    role: MembershipRole | None = None
    auth_mode: str = "anonymous"
    session_expires_at: datetime | None = None
    accessible_workspace_ids: tuple[str, ...] = ()
    workspace_access_restricted: bool = False

    @property
    def is_authenticated(self) -> bool:
        return self.user_id is not None

    @property
    def is_scoped(self) -> bool:
        return self.organization_id is not None


ROLE_PERMISSIONS: dict[MembershipRole, tuple[str, ...]] = {
    MembershipRole.OWNER: (
        "manage_company",
        "manage_accounts",
        "manage_data",
        "view_data",
        "view_plans",
        "view_reports",
        "run_scheduling",
        "edit_plan",
        "publish_scenario",
        "manage_integrations",
    ),
    MembershipRole.ADMIN: (
        "manage_company",
        "manage_accounts",
        "manage_data",
        "view_data",
        "view_plans",
        "view_reports",
        "run_scheduling",
        "edit_plan",
        "publish_scenario",
        "manage_integrations",
    ),
    MembershipRole.PLANNER: (
        "view_data",
        "view_plans",
        "view_reports",
        "run_scheduling",
        "edit_plan",
        "publish_scenario",
    ),
    MembershipRole.VIEWER: (
        "view_data",
        "view_plans",
        "view_reports",
    ),
    MembershipRole.INTEGRATOR: (
        "view_data",
        "view_plans",
        "manage_integrations",
    ),
}


def permissions_for_role(role: MembershipRole | None) -> list[str]:
    if role is None:
        return []
    return list(ROLE_PERMISSIONS.get(role, ()))


def ensure_permission(context: TenantContext, permission: str) -> None:
    """Authorize a scoped user while keeping unscoped local-dev calls working."""

    if context.role is None:
        return
    if permission in permissions_for_role(context.role):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "error": "permission_required",
            "message": (
                f"Role {context.role.value!r} is not allowed to perform "
                f"{permission!r}."
            ),
            "required_permission": permission,
        },
    )


def ensure_authenticated_permission(context: TenantContext, permission: str) -> None:
    """Authorize routes that must never be callable anonymously."""

    if context.role is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "login_required",
                "message": f"Login before requesting {permission!r}.",
                "required_permission": permission,
            },
        )
    ensure_permission(context, permission)


def get_tenant_organization_repository(
    session: Session = Depends(get_db_session),
) -> OrganizationRepository:
    return SqlOrganizationRepository(session)


def get_tenant_membership_repository(
    session: Session = Depends(get_db_session),
) -> MembershipRepository:
    return SqlMembershipRepository(session)


def get_tenant_workspace_repository(
    session: Session = Depends(get_db_session),
) -> WorkspaceRepository:
    return SqlWorkspaceRepository(session)


def get_tenant_revoked_auth_token_repository(
    session: Session = Depends(get_db_session),
) -> RevokedAuthTokenRepository:
    """Local factory — duplicated with dependencies.get_revoked_auth_token_repository
    to avoid an import cycle (tenant.py imports from dependencies, and a
    dependency on the revocation repo wired through that file would
    create the cycle). FastAPI overrides target this symbol in tests."""

    return SqlRevokedAuthTokenRepository(session)


def get_tenant_user_session_revocation_repository(
    session: Session = Depends(get_db_session),
) -> UserSessionRevocationRepository:
    """Local factory for the user-keyed mass-revocation port — kept
    here for the same import-cycle reason as the hash-keyed twin. The
    P3.2b admin route reuses :func:`dependencies.get_user_session_revocation_repository`
    so overrides land on both symbols in tests."""

    return SqlUserSessionRevocationRepository(session)


def get_tenant_context(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_organization_id: str | None = Header(default=None, alias="X-Organization-Id"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
    organizations: OrganizationRepository = Depends(get_tenant_organization_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
    workspaces: WorkspaceRepository = Depends(get_tenant_workspace_repository),
    revoked_auth_tokens: RevokedAuthTokenRepository = Depends(
        get_tenant_revoked_auth_token_repository
    ),
    user_session_revocations: UserSessionRevocationRepository = Depends(
        get_tenant_user_session_revocation_repository
    ),
    accessible_workspaces: ListAccessibleWorkspaces = Depends(get_list_accessible_workspaces),
) -> TenantContext:
    """Resolve the acting tenant from headers, validating against the DB.

    - No headers -> empty context (local dev / internal tooling).
    - Organization without user -> 400.
    - Unknown organization -> 404.
    - User id without active membership -> 403.
    """

    session_claims = None
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "invalid_authorization",
                    "message": "Authorization header must use Bearer <token>.",
                },
            )
        try:
            session_claims = verify_auth_session(token)
        except InvalidAuthSession as exc:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "invalid_session",
                    "message": "Planner session is invalid or expired.",
                    "reason": str(exc),
                },
            ) from exc
        # Revocation check runs AFTER signature/expiry — there's no
        # point asking the DB about a token that's already malformed,
        # and we want a hostile probe with random bytes to fail at the
        # cheap cryptographic gate, not after an SQL round-trip.
        token_hash = hash_auth_session_token(token)
        try:
            is_revoked = revoked_auth_tokens.is_revoked(token_hash)
        except Exception:
            # Revocation store outage MUST NOT take auth offline; a
            # signature-valid token continues to work until expiry.
            # The alternative — fail closed on DB blip — would mass-
            # logout every planner in the plant on a transient outage,
            # which is worse than the 12h-window where logout becomes
            # eventually-consistent. The trade-off is documented; if
            # the threat model later requires fail-closed, flip it
            # here and add a circuit-breaker.
            is_revoked = False
        if is_revoked:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "invalid_session",
                    "message": "Planner session has been revoked.",
                    "reason": "revoked",
                },
            )
        # User-keyed mass revocation (P3.2b). An admin click on
        # /accounts/users/{id}/revoke-sessions records a cutoff; any
        # token signed BEFORE that cutoff stops working immediately
        # without enumerating its hash. Same fail-open semantics as
        # the hash gate above — a transient DB blip on this store must
        # not lock out the plant.
        try:
            revoked_before = user_session_revocations.get_revoked_before(
                session_claims.user_id
            )
        except Exception:
            revoked_before = None
        if revoked_before is not None:
            # The store keeps naive datetimes (DB convention); the
            # claim ``issued_at`` is tz-aware UTC. Compare in the same
            # frame to avoid a TypeError under a real DB driver.
            issued_at_naive = session_claims.issued_at.replace(tzinfo=None)
            if issued_at_naive < revoked_before:
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "invalid_session",
                        "message": "Planner session has been revoked.",
                        "reason": "revoked_by_admin",
                    },
                )

    if session_claims is None and not x_organization_id and not x_user_id and not x_workspace_id:
        return TenantContext()

    organization_id = x_organization_id
    user_id = x_user_id
    auth_mode = "header" if (x_organization_id or x_user_id) else "anonymous"
    session_expires_at = None

    if session_claims is not None:
        organization_id = session_claims.organization_id
        user_id = session_claims.user_id
        auth_mode = "session"
        session_expires_at = session_claims.expires_at
        if x_organization_id and x_organization_id != organization_id:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "cross_tenant_forbidden",
                    "message": "X-Organization-Id does not match the signed session.",
                },
            )
        if x_user_id and x_user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "cross_user_forbidden",
                    "message": "X-User-Id does not match the signed session.",
                },
            )
    else:
        # Real-auth slice 4: when the deployment requires a password
        # on /auth/login, header-based identity becomes a security
        # bypass — anyone who knows a user id could skip the
        # credential check by sending X-User-Id directly. Pin the
        # two flags together so a misconfigured env can't accidentally
        # open the back door.
        _settings = get_settings()
        if _settings.auth_require_password or not _settings.auth_allow_header_identity:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "legacy_identity_disabled",
                    "message": (
                        "Header-based identity is not accepted in "
                        "password-required mode. Sign in at /auth/login "
                        "to obtain a Bearer session token."
                    ),
                },
            )

    if not organization_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_organization",
                "message": "X-Organization-Id header is required when X-User-Id is provided.",
            },
        )

    organization = organizations.get(organization_id)
    if organization is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "organization_not_found",
                "message": f"Organization {organization_id!r} does not exist.",
            },
        )

    if not user_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_user",
                "message": "X-User-Id header is required when X-Organization-Id is provided.",
            },
        )

    membership = memberships.get(organization.id, user_id)
    if membership is None or not membership.is_active:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "membership_required",
                "message": (
                    f"User {user_id!r} has no active membership in "
                    f"organization {organization.id!r}."
                ),
            },
        )

    accessible_workspaces_in_org = accessible_workspaces.execute(
        organization.id,
        user_id,
    )
    accessible_workspace_ids = tuple(
        workspace.id for workspace in accessible_workspaces_in_org
    )
    workspace_access_restricted = accessible_workspaces.has_explicit_grants(
        organization.id,
        user_id,
    )

    workspace_id = None
    if x_workspace_id:
        workspace = workspaces.get(x_workspace_id)
        if (
            workspace is None
            or not workspace.is_active
            or workspace.organization_id != organization.id
        ):
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "workspace_not_found",
                    "message": (
                        f"Workspace {x_workspace_id!r} does not exist in "
                        f"organization {organization.id!r}."
                    ),
                },
            )
        if not accessible_workspaces.can_access_workspace(
            organization_id=organization.id,
            user_id=user_id,
            workspace_id=workspace.id,
        ):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "workspace_access_required",
                    "message": (
                        f"User {user_id!r} is not allowed to open "
                        f"workspace {workspace.id!r}."
                    ),
                },
            )
        workspace_id = workspace.id

    return TenantContext(
        organization_id=organization.id,
        user_id=user_id,
        workspace_id=workspace_id,
        role=membership.role,
        auth_mode=auth_mode,
        session_expires_at=session_expires_at,
        accessible_workspace_ids=accessible_workspace_ids,
        workspace_access_restricted=workspace_access_restricted,
    )


def resolve_scoped_organization_id(
    context: TenantContext,
    requested_organization_id: str | None,
) -> str | None:
    """Reconcile a per-request organization id with the tenant context.

    - No context -> keep requested value.
    - Context set, requested is None -> inherit from context.
    - Both set but equal -> keep requested value.
    - Both set and different -> 403 (cross-tenant write attempt).
    """

    if context.organization_id is None:
        return requested_organization_id
    if requested_organization_id is None:
        return context.organization_id
    if requested_organization_id != context.organization_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "cross_tenant_forbidden",
                "message": (
                    "Payload organization_id does not match the tenant context."
                ),
            },
        )
    return context.organization_id


def verify_payload_workspace_in_org(
    workspaces: WorkspaceRepository,
    *,
    organization_id: str,
    workspace_id: str | None,
) -> None:
    """Reject a payload workspace_id that does not belong to the active org.

    Prevents cross-org enumeration via POST body fields. Skip when no
    workspace_id is provided (route accepts org-wide scope).
    """

    if not workspace_id:
        return
    workspace = workspaces.get(workspace_id)
    if (
        workspace is None
        or not workspace.is_active
        or workspace.organization_id != organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail={
                "error": "workspace_not_found",
                "message": (
                    f"Workspace {workspace_id!r} does not exist in "
                    f"organization {organization_id!r}."
                ),
            },
        )


def resolve_scoped_workspace_id(
    context: TenantContext,
    requested_workspace_id: str | None,
) -> str | None:
    """Reconcile payload workspace id with the active tenant workspace."""

    if context.workspace_id is None:
        if (
            requested_workspace_id is not None
            and context.workspace_access_restricted
            and requested_workspace_id not in context.accessible_workspace_ids
        ):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "workspace_access_required",
                    "message": "Payload workspace_id is outside the granted workspace scope.",
                },
            )
        return requested_workspace_id
    if requested_workspace_id is None:
        return context.workspace_id
    if requested_workspace_id != context.workspace_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "cross_workspace_forbidden",
                "message": "Payload workspace_id does not match the tenant context.",
            },
        )
    return context.workspace_id
