"""Port: store external-system to internal-id bindings for idempotent imports."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class IntegrationBinding:
    entity_type: str
    source_system: str
    external_ref: str
    internal_id: str


class IntegrationBindingRepository(Protocol):
    def get(
        self,
        *,
        entity_type: str,
        source_system: str,
        external_ref: str,
    ) -> IntegrationBinding | None: ...

    def save(self, binding: IntegrationBinding) -> IntegrationBinding:
        """First-writer-wins upsert: return the binding actually persisted.

        Implementations MUST behave as an atomic upsert on
        ``(entity_type, source_system, external_ref)``:

        - if the key is free, persist the supplied ``binding`` and return it;
        - if the key is already taken, KEEP the stored ``internal_id`` (the
          first writer wins) and return the stored binding.

        Callers compare the returned ``internal_id`` to the one they tried to
        insert to detect a race condition between two concurrent imports.
        Updating ``internal_id`` on conflict would silently break ``_resolve_internal_id``'s
        idempotency guarantee — two concurrent flows would diverge on which
        internal id their downstream writes point at.
        """
        ...

    def find_external_refs(
        self,
        *,
        entity_type: str,
        source_system: str,
        internal_ids: Iterable[str],
    ) -> dict[str, str]:
        """Reverse lookup: internal_id -> external_ref for a batch of ids.

        Returns a dict keyed by internal_id with the external_ref recorded for
        that binding. Internal ids that have no binding are simply absent from
        the result (callers fall back to whatever convention they prefer —
        usually skipping the record).
        """
        ...
