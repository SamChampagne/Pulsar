from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from planiadvance_v2.config import Settings
from planiadvance_v2.infrastructure.bootstrap import ensure_tenant_fixture
from planiadvance_v2.infrastructure.db.base import Base
from planiadvance_v2.infrastructure.db.models import (  # noqa: F401
    MembershipModel,
    OrganizationModel,
    UserAccountModel,
    WorkspaceModel,
)
from planiadvance_v2.infrastructure.db.repositories import (
    SqlMembershipRepository,
    SqlOrganizationRepository,
    SqlUserAccountRepository,
    SqlWorkspaceRepository,
)


def test_ensure_tenant_fixture_creates_seed_org_user_membership_and_workspace() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        seed_organization_id="org-demo",
        seed_organization_name="Demo Organization",
        seed_organization_slug="demo",
        seed_user_id="user-1",
        seed_user_email="planner@demo.local",
        seed_user_display_name="Demo Planner",
        seed_workspace_id="default",
        seed_workspace_name="Default Workspace",
    )

    with Session() as session:
        organization_id = ensure_tenant_fixture(session, settings)
        session.commit()

        assert organization_id == "org-demo"
        assert SqlOrganizationRepository(session).get("org-demo") is not None
        assert SqlUserAccountRepository(session).get("user-1") is not None
        membership = SqlMembershipRepository(session).get("org-demo", "user-1")
        assert membership is not None
        workspace = SqlWorkspaceRepository(session).get("default")
        assert workspace is not None
        assert workspace.organization_id == "org-demo"
