from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...application.ports import (
    MembershipRepository,
    UserAccountRepository,
)
from ...application.use_cases import (
    AddMembership,
    AddMembershipInput,
    CreateOrganization,
    CreateOrganizationInput,
    CreateUserAccount,
    CreateUserAccountInput,
    GrantWorkspaceAccess,
    GrantWorkspaceAccessInput,
    ListMemberships,
    ListOrganizations,
    ListOrganizationWorkspaces,
    ListUserAccounts,
    ListWorkspaceAccessGrants,
    RevokeWorkspaceAccess,
    record_audit_event,
)
from ...config import get_settings
from ...domain.entities import (
    Membership,
    Organization,
    UserAccount,
    Workspace,
    WorkspaceAccessGrant,
)
from ...infrastructure.db.repositories import (
    SqlAuditEventRepository,
    SqlUserAccountRepository,
    SqlUserSessionRevocationRepository,
)
from ..dependencies import (
    get_add_membership,
    get_audit_event_repository,
    get_create_organization,
    get_create_user_account,
    get_db_session,
    get_grant_workspace_access,
    get_list_memberships,
    get_list_organization_workspaces,
    get_list_organizations,
    get_list_user_accounts,
    get_list_workspace_access_grants,
    get_revoke_workspace_access,
    get_user_session_revocation_repository,
)
from ..schemas import (
    ApiErrorResponse,
    MembershipIn,
    MembershipOut,
    OrganizationIn,
    OrganizationOut,
    RevokeUserSessionsOut,
    UserAccountIn,
    UserAccountOut,
    WorkspaceAccessGrantIn,
    WorkspaceAccessGrantOut,
    WorkspaceOut,
)
from ..tenant import (
    TenantContext,
    ensure_authenticated_permission,
    get_tenant_context,
    get_tenant_membership_repository,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])


def get_admin_user_repository(
    session: Session = Depends(get_db_session),
) -> UserAccountRepository:
    """Local factory for the user-account repo so the revoke-sessions
    route can be overridden in tests without dragging in auth.py.

    Duplicated with :func:`api.routes.auth.get_auth_user_repository`
    to avoid a circular import (auth.py already imports formatting
    helpers from this module). FastAPI dependency overrides target
    this symbol when testing the accounts surface."""

    return SqlUserAccountRepository(session)


def _organization_to_out(organization: Organization) -> OrganizationOut:
    return OrganizationOut(
        id=organization.id,
        name=organization.name,
        slug=organization.slug,
        is_active=organization.is_active,
    )


def _user_to_out(user: UserAccount) -> UserAccountOut:
    return UserAccountOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
    )


def _membership_to_out(membership: Membership) -> MembershipOut:
    return MembershipOut(
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        role=membership.role.value,
        is_active=membership.is_active,
    )


def _workspace_to_out(workspace: Workspace) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        description=workspace.description,
        organization_id=workspace.organization_id,
        is_default=workspace.is_default,
        is_active=workspace.is_active,
        plant_timezone=workspace.plant_timezone,
    )


def _workspace_access_grant_to_out(
    grant: WorkspaceAccessGrant,
) -> WorkspaceAccessGrantOut:
    return WorkspaceAccessGrantOut(
        organization_id=grant.organization_id,
        workspace_id=grant.workspace_id,
        user_id=grant.user_id,
        is_active=grant.is_active,
    )


@router.get("/organizations", response_model=list[OrganizationOut])
def list_organizations(
    use_case: ListOrganizations = Depends(get_list_organizations),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[OrganizationOut]:
    ensure_authenticated_permission(tenant, "manage_company")
    return [_organization_to_out(organization) for organization in use_case.execute()]


@router.post("/organizations", response_model=OrganizationOut, status_code=201)
def create_organization(
    payload: OrganizationIn,
    request: Request,
    use_case: CreateOrganization = Depends(get_create_organization),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> OrganizationOut:
    ensure_authenticated_permission(tenant, "manage_company")
    organization = use_case.execute(
        CreateOrganizationInput(
            id=payload.id,
            name=payload.name,
            slug=payload.slug,
            is_active=payload.is_active,
        )
    )
    try:
        record_audit_event(
            audit_repository,
            action="accounts.organization_created",
            status="ok",
            organization_id=organization.id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=organization.slug or organization.id,
            details={"name": organization.name, "is_active": organization.is_active},
        )
    except Exception:
        pass
    return _organization_to_out(organization)


@router.get("/users", response_model=list[UserAccountOut])
def list_users(
    use_case: ListUserAccounts = Depends(get_list_user_accounts),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[UserAccountOut]:
    ensure_authenticated_permission(tenant, "manage_accounts")
    return [_user_to_out(user) for user in use_case.execute()]


@router.post("/users", response_model=UserAccountOut, status_code=201)
def create_user(
    payload: UserAccountIn,
    request: Request,
    use_case: CreateUserAccount = Depends(get_create_user_account),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> UserAccountOut:
    ensure_authenticated_permission(tenant, "manage_accounts")
    user = use_case.execute(
        CreateUserAccountInput(
            id=payload.id,
            email=payload.email,
            display_name=payload.display_name,
            is_active=payload.is_active,
        )
    )
    # Real-auth slice 9: hash + stamp the password after the user
    # exists so the validation and audit happen via the same path the
    # set-password endpoint uses. We re-use the UserAccount repo via
    # the use case's internal handle to keep the call site small.
    if payload.password:
        from ..password_policy import PasswordPolicyError, check_password_policy
        from ..passwords import hash_password

        try:
            check_password_policy(
                payload.password, user_id=user.id, email=user.email
            )
        except PasswordPolicyError as exc:
            raise HTTPException(
                status_code=422,
                detail={"error": "weak_password", "message": str(exc)},
            ) from exc
        user.password_hash = hash_password(payload.password)
        use_case._users.add(user)  # type: ignore[attr-defined]
    try:
        record_audit_event(
            audit_repository,
            action="accounts.user_created",
            status="ok",
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=user.email or user.id,
            details={
                "user_id": user.id,
                "is_active": user.is_active,
                "has_password": user.password_hash is not None,
            },
        )
    except Exception:
        pass
    return _user_to_out(user)


@router.get(
    "/organizations/{organization_id}/memberships",
    response_model=list[MembershipOut],
)
def list_organization_memberships(
    organization_id: str,
    use_case: ListMemberships = Depends(get_list_memberships),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[MembershipOut]:
    ensure_authenticated_permission(tenant, "manage_accounts")
    return [
        _membership_to_out(membership)
        for membership in use_case.for_organization(organization_id)
    ]


@router.get(
    "/organizations/{organization_id}/workspaces",
    response_model=list[WorkspaceOut],
)
def list_organization_workspaces(
    organization_id: str,
    use_case: ListOrganizationWorkspaces = Depends(get_list_organization_workspaces),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[WorkspaceOut]:
    ensure_authenticated_permission(tenant, "manage_accounts")
    return [_workspace_to_out(workspace) for workspace in use_case.execute(organization_id)]


@router.get(
    "/organizations/{organization_id}/workspace-access-grants",
    response_model=list[WorkspaceAccessGrantOut],
)
def list_organization_workspace_access_grants(
    organization_id: str,
    use_case: ListWorkspaceAccessGrants = Depends(get_list_workspace_access_grants),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[WorkspaceAccessGrantOut]:
    ensure_authenticated_permission(tenant, "manage_accounts")
    return [
        _workspace_access_grant_to_out(grant)
        for grant in use_case.for_organization(organization_id)
    ]


@router.post(
    "/organizations/{organization_id}/memberships",
    response_model=MembershipOut,
    status_code=201,
)
def add_membership(
    organization_id: str,
    payload: MembershipIn,
    request: Request,
    use_case: AddMembership = Depends(get_add_membership),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> MembershipOut:
    ensure_authenticated_permission(tenant, "manage_accounts")
    membership = use_case.execute(
        AddMembershipInput(
            organization_id=organization_id,
            user_id=payload.user_id,
            role=payload.role,
            is_active=payload.is_active,
        )
    )
    try:
        record_audit_event(
            audit_repository,
            action="accounts.membership_added",
            status="ok",
            organization_id=organization_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=membership.user_id,
            details={
                "target_user_id": membership.user_id,
                "role": membership.role.value,
                "is_active": membership.is_active,
            },
        )
    except Exception:
        pass
    return _membership_to_out(membership)


@router.post(
    "/workspaces/{workspace_id}/access-grants",
    response_model=WorkspaceAccessGrantOut,
    status_code=201,
)
def grant_workspace_access(
    workspace_id: str,
    payload: WorkspaceAccessGrantIn,
    request: Request,
    use_case: GrantWorkspaceAccess = Depends(get_grant_workspace_access),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> WorkspaceAccessGrantOut:
    ensure_authenticated_permission(tenant, "manage_accounts")
    if tenant.organization_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_organization",
                "message": "Active organization is required to grant workspace access.",
            },
        )
    grant = use_case.execute(
        GrantWorkspaceAccessInput(
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            user_id=payload.user_id,
            is_active=payload.is_active,
        )
    )
    try:
        record_audit_event(
            audit_repository,
            action="accounts.workspace_access_granted",
            status="ok",
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=grant.user_id,
            details={
                "target_user_id": grant.user_id,
                "workspace_id": grant.workspace_id,
                "is_active": grant.is_active,
            },
        )
    except Exception:
        pass
    return _workspace_access_grant_to_out(grant)


@router.delete("/workspaces/{workspace_id}/access-grants/{user_id}", status_code=204)
def revoke_workspace_access(
    workspace_id: str,
    user_id: str,
    request: Request,
    use_case: RevokeWorkspaceAccess = Depends(get_revoke_workspace_access),
    tenant: TenantContext = Depends(get_tenant_context),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> None:
    ensure_authenticated_permission(tenant, "manage_accounts")
    if tenant.organization_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_organization",
                "message": "Active organization is required to revoke workspace access.",
            },
        )
    use_case.execute(
        organization_id=tenant.organization_id,
        workspace_id=workspace_id,
        user_id=user_id,
    )
    try:
        record_audit_event(
            audit_repository,
            action="accounts.workspace_access_revoked",
            status="ok",
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=user_id,
            details={"target_user_id": user_id, "workspace_id": workspace_id},
        )
    except Exception:
        pass


@router.get("/users/{user_id}/memberships", response_model=list[MembershipOut])
def list_user_memberships(
    user_id: str,
    use_case: ListMemberships = Depends(get_list_memberships),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[MembershipOut]:
    ensure_authenticated_permission(tenant, "manage_accounts")
    return [_membership_to_out(membership) for membership in use_case.for_user(user_id)]


@router.post(
    "/users/{user_id}/revoke-sessions",
    response_model=RevokeUserSessionsOut,
    summary="Mass-revoke a user's active planner sessions",
    description=(
        "Admin endpoint: record a per-user ``revoked_before_iat`` cutoff so "
        "every outstanding planner bearer issued to this user (before now) "
        "stops working immediately on the next request. New sign-ins still "
        "work — only tokens older than the cutoff are blocked.\n\n"
        "Requires the caller to hold ``manage_accounts`` and to share an "
        "organization with the target user (defense in depth: cross-org "
        "admins cannot mass-revoke users they don't co-tenant with). "
        "Idempotent: a second click within the same second is a no-op."
    ),
    responses={
        403: {"model": ApiErrorResponse, "description": "Caller lacks manage_accounts."},
        404: {
            "model": ApiErrorResponse,
            "description": "Target user does not exist in the caller's organization.",
        },
    },
)
def revoke_user_sessions(
    user_id: str,
    request: Request,
    tenant: TenantContext = Depends(get_tenant_context),
    users: UserAccountRepository = Depends(get_admin_user_repository),
    memberships: MembershipRepository = Depends(get_tenant_membership_repository),
    revocations: SqlUserSessionRevocationRepository = Depends(
        get_user_session_revocation_repository
    ),
    audit_repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
) -> RevokeUserSessionsOut:
    ensure_authenticated_permission(tenant, "manage_accounts")

    target = users.get(user_id)
    # Cross-org isolation: an admin in Org A must not be able to mass-
    # revoke a user who only belongs to Org B. We require the caller
    # and the target to share at least one organization, and we
    # collapse "user not found" + "user not in my org" into the same
    # 404 so a probe cannot enumerate users across tenants.
    in_scope = False
    if target is not None and tenant.organization_id is not None:
        in_scope = (
            memberships.get(tenant.organization_id, target.id) is not None
        )
    if target is None or not in_scope:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "user_not_found",
                "message": f"User {user_id!r} does not exist.",
            },
        )

    # The store keeps naive datetimes (DB convention). Snapshot the
    # cutoff once so the audit record and the persisted row agree to
    # the microsecond — useful when tracing "revoked, but token still
    # works for 2 more requests" reports back to the actual cutoff.
    now_naive = datetime.now(UTC).replace(tzinfo=None)
    revocations.revoke_user_sessions(
        target.id,
        revoked_before_iat=now_naive,
        revoked_at=now_naive,
    )
    # Opportunistic janitor on the same TTL the signature gate enforces
    # — same pattern as /auth/logout's purge_expired call. Cheap, keeps
    # the table bounded without a separate scheduled task.
    try:
        revocations.purge_obsolete(
            now=now_naive,
            max_session_age=get_settings().auth_session_ttl_hours,
        )
    except Exception:
        pass

    try:
        record_audit_event(
            audit_repository,
            action="auth.sessions_revoked",
            status="ok",
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            ip_address=request.client.host if request.client else None,
            subject=target.email or target.id,
            details={"target_user_id": target.id},
        )
    except Exception:
        # Audit failure must never block the security action. The
        # revocation row is already persisted — that's the part that
        # actually matters for the user-facing effect.
        pass

    return RevokeUserSessionsOut(
        user_id=target.id,
        revoked_before=now_naive,
    )
