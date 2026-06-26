from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ....application.ports.integration_binding_repository import (
    IntegrationBinding,
)
from ..models import IntegrationBindingModel


class SqlIntegrationBindingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(
        self,
        *,
        entity_type: str,
        source_system: str,
        external_ref: str,
    ) -> IntegrationBinding | None:
        stmt = select(IntegrationBindingModel).where(
            IntegrationBindingModel.entity_type == entity_type,
            IntegrationBindingModel.source_system == source_system,
            IntegrationBindingModel.external_ref == external_ref,
        )
        row = self._session.execute(stmt).scalars().first()
        if row is None:
            return None
        return IntegrationBinding(
            entity_type=row.entity_type,
            source_system=row.source_system,
            external_ref=row.external_ref,
            internal_id=row.internal_id,
        )

    def save(self, binding: IntegrationBinding) -> IntegrationBinding:
        # V1.2 P0.2 — atomic upsert. Replaces the previous SELECT-then-
        # INSERT/UPDATE which had a classic TOCTOU race: two concurrent
        # imports could both miss the SELECT, both call INSERT, and the
        # loser would crash on the uq_integration_binding_key UniqueConstraint
        # (HTTP 500 for the user) instead of converging on one row.
        #
        # ON CONFLICT DO UPDATE SET updated_at = ... (NOT internal_id)
        # implements first-writer-wins: the existing internal_id is
        # preserved, so downstream domain writes from both flows resolve
        # to the same id. The RETURNING gives us the binding that
        # actually persisted (the winner's), which the caller compares
        # against what it tried to insert to detect a lost race.
        now = datetime.utcnow()
        stmt = (
            pg_insert(IntegrationBindingModel)
            .values(
                entity_type=binding.entity_type,
                source_system=binding.source_system,
                external_ref=binding.external_ref,
                internal_id=binding.internal_id,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_integration_binding_key",
                set_={"updated_at": now},
            )
            .returning(IntegrationBindingModel)
        )
        row = self._session.execute(stmt).scalar_one()
        return IntegrationBinding(
            entity_type=row.entity_type,
            source_system=row.source_system,
            external_ref=row.external_ref,
            internal_id=row.internal_id,
        )

    def find_external_refs(
        self,
        *,
        entity_type: str,
        source_system: str,
        internal_ids: Iterable[str],
    ) -> dict[str, str]:
        id_list = list({str(i) for i in internal_ids if i})
        if not id_list:
            return {}
        stmt = select(IntegrationBindingModel).where(
            IntegrationBindingModel.entity_type == entity_type,
            IntegrationBindingModel.source_system == source_system,
            IntegrationBindingModel.internal_id.in_(id_list),
        )
        rows = self._session.execute(stmt).scalars().all()
        return {row.internal_id: row.external_ref for row in rows}
