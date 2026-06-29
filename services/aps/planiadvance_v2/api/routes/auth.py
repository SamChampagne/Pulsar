from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...application.ports import (
    MembershipRepository,
    OrganizationRepository,
    UserAccountRepository,
)
from ...application.use_cases import ListAccessibleWorkspaces, record_audit_event
from ...config import get_settings
from ...domain.entities import Membership, UserAccount
from ...infrastructure.db.repositories import (
    SqlAuditEventRepository,
    SqlRevokedAuthTokenRepository,
    SqlUserAccountRepository,
)
from ...infrastructure.db.session import get_session_factory
from ..auth_sessions import (
    InvalidAuthSession,
    hash_auth_session_token,
    issue_auth_session,
    verify_auth_session,
)
from ..dependencies import (
    get_db_session,
    get_list_accessible_workspaces,
    get_revoked_auth_token_repository,
)
from ..schemas import (
    ApiErrorResponse,
    AuthCompanyMembershipOut,
    AuthContextOut,
    AuthLoginDirectoryOut,
    AuthLoginIn,
    AuthLogoutOut,
    AuthSwitchOrganizationIn,
    SetUserPasswordIn,
    SetUserPasswordOut,
)
from ..security import enforce_rate_limit
from ..tenant import (
    TenantContext,
    ensure_permission,
    get_tenant_context,
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    permissions_for_role,
)
from .accounts import _membership_to_out, _organization_to_out, _user_to_out, _workspace_to_out


def _optional_audit_repository() -> SqlAuditEventRepository | None:
    """Best-effort audit recorder.

    Auth endpoints exist before sessions / tenant context are set up,
    so we can't depend on the standard `get_db_session` (which assumes
    a tenant scope). Open our own session here; if the DB is not
    reachable (unit tests without a real backend, dev envs without
    Postgres up), silently skip the audit so /login still succeeds.
    """

    try:
        factory = get_session_factory()
    except Exception:
        return None

    class _AutoFlushAdapter:
        def save(self, event):  # type: ignore[no-untyped-def]
            try:
                with factory.session() as session:
                    SqlAuditEventRepository(session).save(event)
                    session.commit()
            except Exception:
                # Audit log MUST never block a login.
                pass

        def list_recent(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
            with factory.session() as session:
                return SqlAuditEventRepository(session).list_recent(*_args, **_kwargs)

    return _AutoFlushAdapter()  # type: ignore[return-value]


router = APIRouter(prefix="/auth", tags=["auth"])


def get_auth_user_repository(
    session: Session = Depends(get_db_session),
) -> UserAccountRepository:
    return SqlUserAccountRepository(session)


def _company_contexts(
    *,
    user_id: str,
    memberships: list[Membership],
    organizations: OrganizationRepository,
    accessible_workspaces: ListAccessibleWorkspaces,
) -> list[AuthCompanyMembershipOut]:
    contexts: list[AuthCompanyMembershipOut] = []
    for membership in memberships:
        if not membership.is_active:
            continue
        organization = organizations.get(membership.organization_id)
        if organization is None or not organization.is_active:
            continue
        contexts.append(
            AuthCompanyMembershipOut(
                organization=_organization_to_out(organization),
                membership=_membership_to_out(membership),
                workspaces=[
                    _workspace_to_out(workspace)
                    for workspace in accessible_workspaces.execute(
                        organization.id,
                        user_id,
                    )
                ],
            )
        )
    contexts.sort(key=lambda item: (item.organization.name.lower(), item.organization.id))
    return contexts


def _build_context(
    *,
    user: UserAccount,
    active_membership: Membership,
    organizations: OrganizationRepository,
    memberships: MembershipRepository,
    accessible_workspaces: ListAccessibleWorkspaces,
    auth_mode: str = "session",
    session_token: str | None = None,
    session_expires_at: datetime | None = None,
) -> AuthContextOut:
    organization = organizations.get(active_membership.organization_id)
    if organization is None or not organization.is_active:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "organization_not_found",
                "message": f"Organization {active_membership.organization_id!r} does not exist.",
            },
        )

    all_memberships = memberships.list_for_user(user.id)
    return AuthContextOut(
        authenticated=True,
        auth_mode=auth_mode,
        user=_user_to_out(user),
        active_organization=_organization_to_out(organization),
        active_membership=_membership_to_out(active_membership),
        memberships=_company_contexts(
            user_id=user.id,
            memberships=all_memberships,
            organizations=organizations,
            accessible_workspaces=accessible_workspaces,
        ),
        permissions=permissions_for_role(active_membership.role),
        session_token=session_token,
        session_expires_at=session_expires_at,
    )


def _select_active_membership(
    *,
    user: UserAccount,
    organization_id: str | None,
    organizations: OrganizationRepository,
    memberships: MembershipRepository,
) -> Membership:
    active_memberships = [
        membership
        for membership in memberships.list_for_user(user.id)
        if membership.is_active
    ]
    if not active_memberships:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "membership_required",
                "message": f"User {user.id!r} has no active company membership.",
            },
        )

    if organization_id:
        membership = memberships.get(organization_id, user.id)
        if membership is None or not membership.is_active:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "membership_required",
                    "message": (
                        f"User {user.id!r} has no active membership in "
                        f"organization {organization_id!r}."
                    ),
                },
            )
        return membership

    active_memberships.sort(
        key=lambda membership: (
            organizations.get(membership.organization_id).name.lower()
            if organizations.get(membership.organization_id)
            else membership.organization_id
        )
    )
    return active_memberships[0]


@router.get("/login-directory", response_model=AuthLoginDirectoryOut)
def login_directory(
    users: UserAccountRepository = Depends(get_auth_user_repository),
    organizations: OrganizationRepository = Depends(get_tenant_organization_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
) -> AuthLoginDirectoryOut:
    if not get_settings().auth_expose_login_directory:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "login_directory_disabled",
                "message": "Public login directory is disabled for this deployment.",
            },
        )
    active_users = [user for user in users.list_all() if user.is_active]
    return AuthLoginDirectoryOut(
        users=[_user_to_out(user) for user in active_users],
        organizations=[
            _organization_to_out(organization)
            for organization in organizations.list_all()
            if organization.is_active
        ],
        memberships=[
            _membership_to_out(membership)
            for user in active_users
            for membership in memberships.list_for_user(user.id)
            if membership.is_active
        ],
        password_required=get_settings().auth_require_password,
    )


@router.post("/login", response_model=AuthContextOut)
def login(
    payload: AuthLoginIn,
    request: Request,
    users: UserAccountRepository = Depends(get_auth_user_repository),
    organizations: OrganizationRepository = Depends(get_tenant_organization_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
    accessible_workspaces: ListAccessibleWorkspaces = Depends(get_list_accessible_workspaces),
    audit_repository: SqlAuditEventRepository | None = Depends(_optional_audit_repository),
) -> AuthContextOut:
    settings = get_settings()
    # J7 S2 — throttle credential stuffing / DoS without locking out the
    # legit planner. Keyed by source IP because we don't have a stable
    # client identity yet (the whole point of /login is to obtain one).
    enforce_rate_limit(
        client_id=request.client.host if request.client else "unknown",
        limit_per_minute=settings.auth_login_rate_limit_per_minute,
        scope="auth_login",
    )
    if not settings.auth_selector_login_enabled:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "selector_login_disabled",
                "message": "Interactive selector login is disabled for this deployment.",
            },
        )
    user: UserAccount | None = None
    if payload.user_id:
        user = users.get(payload.user_id)
    elif payload.email:
        user = users.get_by_email(payload.email)
    else:
        active_users = [candidate for candidate in users.list_all() if candidate.is_active]
        if len(active_users) == 1:
            user = active_users[0]

    if user is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "user_not_found",
                "message": "Choose an existing user id or email to start a planning session.",
            },
        )
    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "user_inactive",
                "message": f"User {user.id!r} is inactive.",
            },
        )
    # Real-auth slice 1: when the deployment requires a password, every
    # account must already have a bcrypt hash stored and the login
    # payload must carry the matching plaintext. Bad password → generic
    # 401 (no user-existence leak), missing password → 422 with a
    # field-level message so the UI can highlight the right input.
    if settings.auth_require_password:
        from ..passwords import verify_password  # local import: cheap, keeps cold-start lean

        if not payload.password:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "password_required",
                    "message": "Password is required.",
                },
            )
        if not user.password_hash or not verify_password(
            payload.password, user.password_hash
        ):
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "invalid_credentials",
                    "message": "Invalid user or password.",
                },
            )

    active_membership = _select_active_membership(
        user=user,
        organization_id=payload.organization_id,
        organizations=organizations,
        memberships=memberships,
    )
    session_token, expires_at = issue_auth_session(
        user_id=user.id,
        organization_id=active_membership.organization_id,
    )
    if audit_repository is not None:
        record_audit_event(
            audit_repository,
            action="auth.login",
            status="ok",
            organization_id=active_membership.organization_id,
            user_id=user.id,
            ip_address=request.client.host if request.client else None,
            subject=user.email or user.id,
        )
    return _build_context(
        user=user,
        active_membership=active_membership,
        organizations=organizations,
        memberships=memberships,
        accessible_workspaces=accessible_workspaces,
        auth_mode="session",
        session_token=session_token,
        session_expires_at=expires_at,
    )


@router.get("/me", response_model=AuthContextOut)
def me(
    tenant: TenantContext = Depends(get_tenant_context),
    users: UserAccountRepository = Depends(get_auth_user_repository),
    organizations: OrganizationRepository = Depends(get_tenant_organization_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
    accessible_workspaces: ListAccessibleWorkspaces = Depends(get_list_accessible_workspaces),
) -> AuthContextOut:
    if tenant.user_id is None or tenant.organization_id is None:
        return AuthContextOut(authenticated=False)
    user = users.get(tenant.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "user_not_found",
                "message": f"User {tenant.user_id!r} does not exist.",
            },
        )
    membership = memberships.get(tenant.organization_id, user.id)
    if membership is None or not membership.is_active:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "membership_required",
                "message": (
                    f"User {user.id!r} has no active membership in "
                    f"organization {tenant.organization_id!r}."
                ),
            },
        )
    return _build_context(
        user=user,
        active_membership=membership,
        organizations=organizations,
        memberships=memberships,
        accessible_workspaces=accessible_workspaces,
        auth_mode=tenant.auth_mode,
        session_expires_at=tenant.session_expires_at,
    )


@router.post("/switch-organization", response_model=AuthContextOut)
def switch_organization(
    payload: AuthSwitchOrganizationIn,
    tenant: TenantContext = Depends(get_tenant_context),
    users: UserAccountRepository = Depends(get_auth_user_repository),
    organizations: OrganizationRepository = Depends(get_tenant_organization_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
    accessible_workspaces: ListAccessibleWorkspaces = Depends(get_list_accessible_workspaces),
) -> AuthContextOut:
    if tenant.user_id is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "login_required",
                "message": "Login before switching company.",
            },
        )
    user = users.get(tenant.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "user_not_found",
                "message": f"User {tenant.user_id!r} does not exist.",
            },
        )
    active_membership = _select_active_membership(
        user=user,
        organization_id=payload.organization_id,
        organizations=organizations,
        memberships=memberships,
    )
    session_token, expires_at = issue_auth_session(
        user_id=user.id,
        organization_id=active_membership.organization_id,
    )
    return _build_context(
        user=user,
        active_membership=active_membership,
        organizations=organizations,
        memberships=memberships,
        accessible_workspaces=accessible_workspaces,
        auth_mode="session",
        session_token=session_token,
        session_expires_at=expires_at,
    )


@router.post("/logout", response_model=AuthLogoutOut)
def logout(
    request: Request,
    revoked_auth_tokens: SqlRevokedAuthTokenRepository = Depends(
        get_revoked_auth_token_repository
    ),
    audit_repository: SqlAuditEventRepository | None = Depends(_optional_audit_repository),
) -> AuthLogoutOut:
    """Revoke the caller's bearer token immediately.

    The v1 session token is HMAC-signed and stateless — without this
    endpoint a "logout" click was cosmetic only (the bearer kept
    working until ``exp``). We now hash the token and persist the
    revocation so subsequent requests with the same bearer fail
    sign-in at :func:`api.tenant.get_tenant_context`.

    Tolerant by design:
    - No Authorization header  -> 200 (nothing to revoke; idempotent UX).
    - Malformed / expired token -> 200 (already useless; reporting the
      revocation as a no-op keeps the logout button always safe to click).
    - Already-revoked token    -> 200 (idempotent on the persistence layer).
    """

    authorization = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not authorization:
        return AuthLogoutOut()

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return AuthLogoutOut()

    try:
        claims = verify_auth_session(token)
    except InvalidAuthSession:
        return AuthLogoutOut()

    token_hash = hash_auth_session_token(token)
    now = datetime.utcnow()
    revoked_auth_tokens.revoke(
        token_hash,
        expires_at=claims.expires_at.replace(tzinfo=None),
        revoked_at=now,
    )
    # Opportunistic purge keeps the table bounded without a separate
    # scheduled job — every logout cleans up the tokens that have
    # already expired naturally. Cheap because the table only grows
    # at the rate of real logouts.
    try:
        revoked_auth_tokens.purge_expired(now=now)
    except Exception:
        pass

    if audit_repository is not None:
        try:
            record_audit_event(
                audit_repository,
                action="auth.logout",
                status="ok",
                organization_id=claims.organization_id,
                user_id=claims.user_id,
                ip_address=request.client.host if request.client else None,
                subject=claims.user_id,
                details={"reason": "user_logout"},
            )
        except Exception:
            pass

    return AuthLogoutOut()


@router.post(
    "/users/{user_id}/password",
    response_model=SetUserPasswordOut,
    summary="Set or rotate a user's password",
    description=(
        "Admin endpoint: hash the supplied plaintext with bcrypt and "
        "stamp it on the user account so /auth/login can verify "
        "subsequent sign-ins. Requires the caller to hold the "
        "``manage_accounts`` permission (owner or admin role)."
    ),
    responses={
        403: {"model": ApiErrorResponse, "description": "Caller lacks manage_accounts."},
        404: {"model": ApiErrorResponse, "description": "Target user does not exist."},
    },
)
def set_user_password(
    user_id: str,
    payload: SetUserPasswordIn,
    request: Request,
    tenant: TenantContext = Depends(get_tenant_context),
    users: UserAccountRepository = Depends(get_auth_user_repository),
    audit_repository: SqlAuditEventRepository | None = Depends(_optional_audit_repository),
) -> SetUserPasswordOut:
    ensure_permission(tenant, "manage_accounts")

    target = users.get(user_id)
    if target is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "user_not_found",
                "message": f"User {user_id!r} does not exist.",
            },
        )

    from ..password_policy import PasswordPolicyError, check_password_policy
    from ..passwords import hash_password  # local import: keep cold-start lean

    try:
        check_password_policy(
            payload.password, user_id=target.id, email=target.email
        )
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "weak_password", "message": str(exc)},
        ) from exc

    target.password_hash = hash_password(payload.password)
    users.add(target)

    if audit_repository is not None:
        record_audit_event(
            audit_repository,
            action="auth.password_set",
            status="ok",
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=target.email or target.id,
        )

    return SetUserPasswordOut(user_id=target.id)
