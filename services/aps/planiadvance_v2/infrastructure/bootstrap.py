"""Database bootstrap: migrate schema and insert the demo dataset.

Usable as a one-shot script:

    python -m planiadvance_v2.infrastructure.bootstrap

It is idempotent: existing work orders / machines / calendars with the
same IDs are replaced.
"""

from __future__ import annotations

import logging
import sys
import time
from dataclasses import replace

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.sql import text

from ..config import Settings, get_settings
from ..domain.entities import Membership, MembershipRole, Organization, UserAccount, Workspace
from .db import get_session_factory, init_schema
from .db.repositories import (
    SqlCalendarRepository,
    SqlInventoryRepository,
    SqlMachineRepository,
    SqlMembershipRepository,
    SqlOrganizationRepository,
    SqlResourceRepository,
    SqlSupplyRepository,
    SqlUserAccountRepository,
    SqlWorkOrderRepository,
    SqlWorkspaceRepository,
)
from .seed import (
    DemoDataset,
    anchor_demo_dataset,
    build_seed_dataset,
    next_monday_eight_am,
)

logger = logging.getLogger("planiadvance_v2.bootstrap")


def wait_for_db(max_attempts: int = 30, delay_seconds: float = 1.0) -> None:
    factory = get_session_factory()
    for attempt in range(1, max_attempts + 1):
        try:
            with factory.engine.connect():
                return
        except OperationalError:
            logger.info("DB not ready (attempt %d/%d), retrying…", attempt, max_attempts)
            time.sleep(delay_seconds)
    raise SystemExit("Database never became ready")


def clear_planning_seed_data(session: Session) -> None:
    """Remove demo planning data so switching datasets is deterministic."""

    session.execute(
        text(
            """
            TRUNCATE TABLE
                scheduled_operations,
                schedules,
                operation_routing_alternatives,
                operation_resource_requirements,
                operation_dependencies,
                operation_eligible_machines,
                operations,
                supply_lots,
                inventory_items,
                resources,
                machines,
                calendar_shifts,
                calendars,
                work_orders
            RESTART IDENTITY CASCADE
            """
        )
    )


def ensure_tenant_fixture(session: Session, settings: Settings) -> str | None:
    """Upsert the demo organization + user + membership + workspace.

    Returns the organization_id that master data should be stamped with,
    or None if seeding is configured without a tenant.
    """

    org_id = settings.seed_organization_id.strip()
    if not org_id:
        return None

    organizations = SqlOrganizationRepository(session)
    users = SqlUserAccountRepository(session)
    memberships = SqlMembershipRepository(session)
    workspaces = SqlWorkspaceRepository(session)

    organizations.add(
        Organization(
            id=org_id,
            name=settings.seed_organization_name,
            slug=settings.seed_organization_slug,
            is_active=True,
        )
    )
    session.flush()

    user_id = settings.seed_user_id.strip()
    if user_id:
        # Real-auth slice 1: stamp a bcrypt hash on the demo user so
        # the password-required login flow has a valid credential out
        # of the box. We always set it (even when auth_require_password
        # is False) so flipping the flag doesn't lock the demo account
        # out — selector login keeps working in the meantime.
        from ..api.passwords import hash_password

        seed_pwd = (settings.auth_seed_password or "").strip()
        password_hash = hash_password(seed_pwd) if seed_pwd else None
        users.add(
            UserAccount(
                id=user_id,
                email=settings.seed_user_email,
                display_name=settings.seed_user_display_name,
                is_active=True,
                password_hash=password_hash,
            )
        )
        session.flush()
        memberships.add(
            Membership(
                organization_id=org_id,
                user_id=user_id,
                role=MembershipRole.OWNER,
                is_active=True,
            )
        )

    workspace_id = settings.seed_workspace_id.strip()
    if workspace_id:
        workspaces.add(
            Workspace(
                id=workspace_id,
                name=settings.seed_workspace_name,
                description="Seeded by bootstrap",
                organization_id=org_id,
                is_default=True,
                is_active=True,
            )
        )

    session.flush()
    return org_id


def stamp_dataset_with_organization(
    dataset: DemoDataset,
    organization_id: str,
    workspace_id: str | None = None,
) -> DemoDataset:
    """Return a dataset where every entity carries tenant/workspace scope."""

    def _stamp(entity):
        return replace(
            entity,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )

    return DemoDataset(
        name=dataset.name,
        horizon_start=dataset.horizon_start,
        calendars=[_stamp(c) for c in dataset.calendars],
        machines=[_stamp(m) for m in dataset.machines],
        resources=[_stamp(r) for r in dataset.resources],
        work_orders=[_stamp(w) for w in dataset.work_orders],
        inventory_items=[_stamp(i) for i in dataset.inventory_items],
        supplies=[_stamp(s) for s in dataset.supplies],
        transfer_times=dataset.transfer_times,
    )


def bootstrap() -> None:
    logging.basicConfig(level=get_settings().log_level)
    logger.info("Starting bootstrap…")

    wait_for_db()
    init_schema()
    logger.info("Schema migrated")

    settings = get_settings()
    dataset = build_seed_dataset(settings.seed_dataset)
    if settings.seed_anchor_to_today and len(dataset.work_orders) > 0:
        anchor = next_monday_eight_am()
        logger.info(
            "Anchoring seed dataset %r to %s (was %s)",
            settings.seed_dataset,
            anchor.isoformat(),
            dataset.horizon_start.isoformat(),
        )
        dataset = anchor_demo_dataset(dataset, anchor)
    factory = get_session_factory()

    with factory.session() as session:
        if settings.seed_reset:
            logger.info("Clearing existing seed/runtime planning data")
            clear_planning_seed_data(session)

        organization_id = ensure_tenant_fixture(session, settings)
        if organization_id:
            workspace_id = settings.seed_workspace_id.strip() or None
            logger.info(
                "Stamping seed dataset with organization_id=%s workspace_id=%s",
                organization_id,
                workspace_id,
            )
            dataset = stamp_dataset_with_organization(
                dataset,
                organization_id,
                workspace_id,
            )

        calendars = SqlCalendarRepository(session)
        for cal in dataset.calendars:
            calendars.add(cal)
        session.flush()

        machines = SqlMachineRepository(session)
        for machine in dataset.machines:
            machines.add(machine)
        session.flush()

        resources = SqlResourceRepository(session)
        for resource in dataset.resources:
            resources.add(resource)
        session.flush()

        work_orders = SqlWorkOrderRepository(session)
        for wo in dataset.work_orders:
            work_orders.add(wo)

        inventory = SqlInventoryRepository(session)
        for item in dataset.inventory_items:
            inventory.add(item)

        supplies = SqlSupplyRepository(session)
        for lot in dataset.supplies:
            supplies.add(lot)

    logger.info(
        "Seeded %s dataset: %d calendars, %d machines, %d resources, %d work orders, %d inventory items, %d supply lots",
        dataset.name,
        len(dataset.calendars),
        len(dataset.machines),
        len(dataset.resources),
        len(dataset.work_orders),
        len(dataset.inventory_items),
        len(dataset.supplies),
    )


if __name__ == "__main__":  # pragma: no cover
    try:
        bootstrap()
    except Exception as exc:
        logger.exception("Bootstrap failed: %s", exc)
        sys.exit(1)
