from __future__ import annotations

import pytest

from planiadvance_v2.application.use_cases import (
    AddMembership,
    AddMembershipInput,
    CreateOrganization,
    CreateOrganizationInput,
    CreateUserAccount,
    CreateUserAccountInput,
)
from planiadvance_v2.domain.entities import MembershipRole, Organization, UserAccount
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryUserAccountRepository,
)


class TestAccountDomain:
    def test_validates_user_email(self):
        with pytest.raises(ValidationError):
            UserAccount(id="u1", email="bad-email", display_name="Planner")

    def test_validates_organization_slug(self):
        with pytest.raises(ValidationError):
            Organization(id="org1", name="Plant", slug="")


class TestAccountUseCases:
    def test_create_org_user_and_membership(self):
        organizations = InMemoryOrganizationRepository()
        users = InMemoryUserAccountRepository()
        memberships = InMemoryMembershipRepository()

        org = CreateOrganization(organizations).execute(
            CreateOrganizationInput(id="org-1", name="Plant QC", slug="plant-qc")
        )
        user = CreateUserAccount(users).execute(
            CreateUserAccountInput(
                id="user-1",
                email="Planner@Example.COM",
                display_name="Planner One",
            )
        )
        membership = AddMembership(
            organizations=organizations,
            users=users,
            memberships=memberships,
        ).execute(
            AddMembershipInput(
                organization_id=org.id,
                user_id=user.id,
                role="planner",
            )
        )

        assert user.email == "planner@example.com"
        assert membership.role == MembershipRole.PLANNER
        assert memberships.list_for_organization("org-1") == [membership]

    def test_rejects_duplicate_organization_slug(self):
        organizations = InMemoryOrganizationRepository(
            [Organization(id="org-1", name="Plant", slug="plant")]
        )

        with pytest.raises(ValidationError, match="slug"):
            CreateOrganization(organizations).execute(
                CreateOrganizationInput(id="org-2", name="Plant 2", slug="plant")
            )

    def test_membership_requires_existing_user(self):
        organizations = InMemoryOrganizationRepository(
            [Organization(id="org-1", name="Plant", slug="plant")]
        )

        with pytest.raises(ValidationError, match="UserAccount"):
            AddMembership(
                organizations=organizations,
                users=InMemoryUserAccountRepository(),
                memberships=InMemoryMembershipRepository(),
            ).execute(
                AddMembershipInput(
                    organization_id="org-1",
                    user_id="missing",
                    role="planner",
                )
            )
