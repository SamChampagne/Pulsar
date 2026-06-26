"""Slice 8: cover the new reverse-lookup behavior on both repo impls."""

from __future__ import annotations

from planiadvance_v2.application.ports import IntegrationBinding
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryIntegrationBindingRepository,
)


class TestInMemoryFindExternalRefs:
    def test_returns_internal_to_external_map(self):
        repo = InMemoryIntegrationBindingRepository()
        repo.save(
            IntegrationBinding(
                entity_type="work_order",
                source_system="odoo",
                external_ref="42",
                internal_id="WO-ALPHA-001",
            )
        )
        repo.save(
            IntegrationBinding(
                entity_type="work_order",
                source_system="odoo",
                external_ref="43",
                internal_id="WO-ALPHA-002",
            )
        )

        result = repo.find_external_refs(
            entity_type="work_order",
            source_system="odoo",
            internal_ids=["WO-ALPHA-001", "WO-ALPHA-002", "WO-NOT-PRESENT"],
        )

        assert result == {"WO-ALPHA-001": "42", "WO-ALPHA-002": "43"}

    def test_ignores_other_entity_types(self):
        repo = InMemoryIntegrationBindingRepository()
        repo.save(
            IntegrationBinding(
                entity_type="work_order",
                source_system="odoo",
                external_ref="42",
                internal_id="X",
            )
        )
        repo.save(
            IntegrationBinding(
                entity_type="operation",
                source_system="odoo",
                external_ref="99",
                internal_id="X",
            )
        )

        result = repo.find_external_refs(
            entity_type="work_order",
            source_system="odoo",
            internal_ids=["X"],
        )

        assert result == {"X": "42"}

    def test_ignores_other_source_systems(self):
        repo = InMemoryIntegrationBindingRepository()
        repo.save(
            IntegrationBinding(
                entity_type="work_order",
                source_system="odoo",
                external_ref="42",
                internal_id="X",
            )
        )
        repo.save(
            IntegrationBinding(
                entity_type="work_order",
                source_system="sap",
                external_ref="SAP-X",
                internal_id="X",
            )
        )

        result = repo.find_external_refs(
            entity_type="work_order",
            source_system="sap",
            internal_ids=["X"],
        )

        assert result == {"X": "SAP-X"}

    def test_empty_input_returns_empty_dict(self):
        repo = InMemoryIntegrationBindingRepository()
        assert (
            repo.find_external_refs(
                entity_type="work_order",
                source_system="odoo",
                internal_ids=[],
            )
            == {}
        )

    def test_returns_empty_dict_when_no_match(self):
        repo = InMemoryIntegrationBindingRepository()
        result = repo.find_external_refs(
            entity_type="work_order",
            source_system="odoo",
            internal_ids=["NO-MATCH"],
        )
        assert result == {}
