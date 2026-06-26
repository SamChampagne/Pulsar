"""Use cases for workspace-scoped planner access."""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.entities import Workspace, WorkspaceAccessGrant
from ...domain.errors import ValidationError
from ..ports import (
    MembershipRepository,
    OrganizationRepository,
    UserAccountRepository,
    WorkspaceAccessGrantRepository,
    WorkspaceRepository,
)


@dataclass(slots=True)
class GrantWorkspaceAccessInput:
    organization_id: str
    workspace_id: str
    user_id: str
    is_active: bool = True


class ListWorkspaceAccessGrants:
    def __init__(self, grants: WorkspaceAccessGrantRepository) -> None:
        self._grants = grants

    def for_organization(self, organization_id: str) -> list[WorkspaceAccessGrant]:
        return self._grants.list_for_organization(organization_id)

    def for_workspace(self, workspace_id: str) -> list[WorkspaceAccessGrant]:
        return self._grants.list_for_workspace(workspace_id)

    def for_user(
        self,
        user_id: str,
        *,
        organization_id: str | None = None,
    ) -> list[WorkspaceAccessGrant]:
        return self._grants.list_for_user(user_id, organization_id=organization_id)


class GrantWorkspaceAccess:
    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        users: UserAccountRepository,
        memberships: MembershipRepository,
        workspaces: WorkspaceRepository,
        grants: WorkspaceAccessGrantRepository,
    ) -> None:
        self._organizations = organizations
        self._users = users
        self._memberships = memberships
        self._workspaces = workspaces
        self._grants = grants

    def execute(self, command: GrantWorkspaceAccessInput) -> WorkspaceAccessGrant:
        organization = self._organizations.get(command.organization_id)
        if organization is None or not organization.is_active:
            raise ValidationError(f"Organization {command.organization_id!r} not found")

        user = self._users.get(command.user_id)
        if user is None or not user.is_active:
            raise ValidationError(f"UserAccount {command.user_id!r} not found")

        membership = self._memberships.get(command.organization_id, command.user_id)
        if membership is None or not membership.is_active:
            raise ValidationError(
                "Workspace access requires an active organization membership"
            )

        workspace = self._workspaces.get(command.workspace_id)
        if workspace is None or not workspace.is_active:
            raise ValidationError(f"Workspace {command.workspace_id!r} not found")
        if workspace.organization_id != command.organization_id:
            raise ValidationError(
                "Workspace access grant organization does not match the workspace organization"
            )

        grant = WorkspaceAccessGrant(
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            user_id=command.user_id,
            is_active=command.is_active,
        )
        self._grants.add(grant)
        return grant


class RevokeWorkspaceAccess:
    def __init__(
        self,
        *,
        workspaces: WorkspaceRepository,
        grants: WorkspaceAccessGrantRepository,
    ) -> None:
        self._workspaces = workspaces
        self._grants = grants

    def execute(self, *, organization_id: str, workspace_id: str, user_id: str) -> None:
        workspace = self._workspaces.get(workspace_id)
        if workspace is None or workspace.organization_id != organization_id:
            raise ValidationError(f"Workspace {workspace_id!r} not found")
        self._grants.delete(workspace_id, user_id)


class ListAccessibleWorkspaces:
    def __init__(
        self,
        *,
        workspaces: WorkspaceRepository,
        grants: WorkspaceAccessGrantRepository,
    ) -> None:
        self._workspaces = workspaces
        self._grants = grants

    def execute(self, organization_id: str, user_id: str | None) -> list[Workspace]:
        workspaces = [
            workspace
            for workspace in self._workspaces.list_for_organization(organization_id)
            if workspace.is_active
        ]
        if user_id is None:
            return workspaces
        grants = self._active_grants(organization_id, user_id)
        if not grants:
            return workspaces
        allowed_ids = {grant.workspace_id for grant in grants}
        return [workspace for workspace in workspaces if workspace.id in allowed_ids]

    def has_explicit_grants(self, organization_id: str, user_id: str | None) -> bool:
        if user_id is None:
            return False
        return bool(self._active_grants(organization_id, user_id))

    def can_access_workspace(
        self,
        *,
        organization_id: str,
        user_id: str | None,
        workspace_id: str,
    ) -> bool:
        if user_id is None:
            return True
        grants = self._active_grants(organization_id, user_id)
        if not grants:
            return True
        return workspace_id in {grant.workspace_id for grant in grants}

    def _active_grants(
        self,
        organization_id: str,
        user_id: str,
    ) -> list[WorkspaceAccessGrant]:
        return [
            grant
            for grant in self._grants.list_for_user(
                user_id,
                organization_id=organization_id,
            )
            if grant.is_active
        ]
