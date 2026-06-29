"""Use cases for tenant accounts and memberships."""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.entities import Membership, MembershipRole, Organization, UserAccount
from ...domain.errors import ValidationError
from ..ports import (
    MembershipRepository,
    OrganizationRepository,
    UserAccountRepository,
    WorkspaceRepository,
)


@dataclass(slots=True)
class CreateOrganizationInput:
    id: str
    name: str
    slug: str
    is_active: bool = True


@dataclass(slots=True)
class CreateUserAccountInput:
    id: str
    email: str
    display_name: str
    is_active: bool = True


@dataclass(slots=True)
class AddMembershipInput:
    organization_id: str
    user_id: str
    role: str
    is_active: bool = True


class CreateOrganization:
    def __init__(self, organizations: OrganizationRepository) -> None:
        self._organizations = organizations

    def execute(self, command: CreateOrganizationInput) -> Organization:
        if self._organizations.get(command.id) is not None:
            raise ValidationError(f"Organization {command.id} already exists")
        if self._organizations.get_by_slug(command.slug) is not None:
            raise ValidationError(f"Organization slug {command.slug!r} already exists")
        organization = Organization(
            id=command.id,
            name=command.name,
            slug=command.slug,
            is_active=command.is_active,
        )
        self._organizations.add(organization)
        return organization


class ListOrganizations:
    def __init__(self, organizations: OrganizationRepository) -> None:
        self._organizations = organizations

    def execute(self) -> list[Organization]:
        return self._organizations.list_all()


class CreateUserAccount:
    def __init__(self, users: UserAccountRepository) -> None:
        self._users = users

    def execute(self, command: CreateUserAccountInput) -> UserAccount:
        if self._users.get(command.id) is not None:
            raise ValidationError(f"UserAccount {command.id} already exists")
        if self._users.get_by_email(command.email) is not None:
            raise ValidationError(f"UserAccount email {command.email!r} already exists")
        user = UserAccount(
            id=command.id,
            email=command.email.lower(),
            display_name=command.display_name,
            is_active=command.is_active,
        )
        self._users.add(user)
        return user


class ListUserAccounts:
    def __init__(self, users: UserAccountRepository) -> None:
        self._users = users

    def execute(self) -> list[UserAccount]:
        return self._users.list_all()


class AddMembership:
    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        users: UserAccountRepository,
        memberships: MembershipRepository,
    ) -> None:
        self._organizations = organizations
        self._users = users
        self._memberships = memberships

    def execute(self, command: AddMembershipInput) -> Membership:
        if self._organizations.get(command.organization_id) is None:
            raise ValidationError(f"Organization {command.organization_id} not found")
        if self._users.get(command.user_id) is None:
            raise ValidationError(f"UserAccount {command.user_id} not found")
        role = MembershipRole(command.role)
        membership = Membership(
            organization_id=command.organization_id,
            user_id=command.user_id,
            role=role,
            is_active=command.is_active,
        )
        self._memberships.add(membership)
        return membership


class ListMemberships:
    def __init__(self, memberships: MembershipRepository) -> None:
        self._memberships = memberships

    def for_organization(self, organization_id: str) -> list[Membership]:
        return self._memberships.list_for_organization(organization_id)

    def for_user(self, user_id: str) -> list[Membership]:
        return self._memberships.list_for_user(user_id)


class ListOrganizationWorkspaces:
    def __init__(self, workspaces: WorkspaceRepository) -> None:
        self._workspaces = workspaces

    def execute(self, organization_id: str):
        return self._workspaces.list_for_organization(organization_id)
