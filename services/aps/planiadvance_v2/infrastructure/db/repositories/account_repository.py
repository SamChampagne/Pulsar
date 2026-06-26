from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....domain.entities import Membership, MembershipRole, Organization, UserAccount
from ..models import MembershipModel, OrganizationModel, UserAccountModel


class SqlOrganizationRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[Organization]:
        rows = self._session.execute(
            select(OrganizationModel).order_by(OrganizationModel.name)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, organization_id: str) -> Organization | None:
        row = self._session.get(OrganizationModel, organization_id)
        return self._to_domain(row) if row else None

    def get_by_slug(self, slug: str) -> Organization | None:
        row = self._session.execute(
            select(OrganizationModel).where(OrganizationModel.slug == slug)
        ).scalar_one_or_none()
        return self._to_domain(row) if row else None

    def add(self, organization: Organization) -> None:
        self._session.merge(
            OrganizationModel(
                id=organization.id,
                name=organization.name,
                slug=organization.slug,
                is_active=organization.is_active,
            )
        )

    @staticmethod
    def _to_domain(row: OrganizationModel) -> Organization:
        return Organization(
            id=row.id,
            name=row.name,
            slug=row.slug,
            is_active=row.is_active,
        )


class SqlUserAccountRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[UserAccount]:
        rows = self._session.execute(
            select(UserAccountModel).order_by(UserAccountModel.email)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, user_id: str) -> UserAccount | None:
        row = self._session.get(UserAccountModel, user_id)
        return self._to_domain(row) if row else None

    def get_by_email(self, email: str) -> UserAccount | None:
        row = self._session.execute(
            select(UserAccountModel).where(UserAccountModel.email == email.lower())
        ).scalar_one_or_none()
        return self._to_domain(row) if row else None

    def add(self, user: UserAccount) -> None:
        self._session.merge(
            UserAccountModel(
                id=user.id,
                email=user.email.lower(),
                display_name=user.display_name,
                is_active=user.is_active,
                password_hash=user.password_hash,
            )
        )

    @staticmethod
    def _to_domain(row: UserAccountModel) -> UserAccount:
        return UserAccount(
            id=row.id,
            email=row.email,
            display_name=row.display_name,
            is_active=row.is_active,
            password_hash=row.password_hash,
        )


class SqlMembershipRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_organization(self, organization_id: str) -> list[Membership]:
        rows = self._session.execute(
            select(MembershipModel)
            .where(MembershipModel.organization_id == organization_id)
            .order_by(MembershipModel.user_id)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_user(self, user_id: str) -> list[Membership]:
        rows = self._session.execute(
            select(MembershipModel)
            .where(MembershipModel.user_id == user_id)
            .order_by(MembershipModel.organization_id)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, organization_id: str, user_id: str) -> Membership | None:
        row = self._session.get(
            MembershipModel,
            {"organization_id": organization_id, "user_id": user_id},
        )
        return self._to_domain(row) if row else None

    def add(self, membership: Membership) -> None:
        self._session.merge(
            MembershipModel(
                organization_id=membership.organization_id,
                user_id=membership.user_id,
                role=membership.role.value,
                is_active=membership.is_active,
            )
        )

    @staticmethod
    def _to_domain(row: MembershipModel) -> Membership:
        return Membership(
            organization_id=row.organization_id,
            user_id=row.user_id,
            role=MembershipRole(row.role),
            is_active=row.is_active,
        )
