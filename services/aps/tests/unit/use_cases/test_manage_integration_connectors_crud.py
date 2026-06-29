"""Slice 7A: update + delete coverage for ManageIntegrationConnectors."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import IntegrationConnector
from planiadvance_v2.application.use_cases.integration_connectors import (
    CreateIntegrationConnectorInput,
    ManageIntegrationConnectors,
    UpdateIntegrationConnectorInput,
)
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationCredentialRepository,
)


class _StubSecretResolver:
    """Echoes the value as `seal:<value>` so the test can detect re-sealing."""

    def __init__(self) -> None:
        self.seal_calls: list[str] = []

    def seal(self, value: str) -> str:
        self.seal_calls.append(value)
        return f"sealed:{value}"

    def unseal(self, reference: str) -> str:
        return reference.removeprefix("sealed:") if reference.startswith("sealed:") else ""


class _StubHttpTransport:
    def send(self, request):  # pragma: no cover - not used in CRUD tests
        raise AssertionError("HTTP transport must not be called in CRUD-only tests")


def _make_use_case(
    *,
    seed: list[IntegrationConnector] | None = None,
) -> tuple[ManageIntegrationConnectors, InMemoryIntegrationConnectorRepository, _StubSecretResolver]:
    connectors = InMemoryIntegrationConnectorRepository(seed=seed)
    credentials = InMemoryIntegrationCredentialRepository()
    secret_resolver = _StubSecretResolver()
    use_case = ManageIntegrationConnectors(
        connectors,
        http_transport=_StubHttpTransport(),
        secret_resolver=secret_resolver,
        credentials=credentials,
    )
    return use_case, connectors, secret_resolver


def _create_http(use_case: ManageIntegrationConnectors, *, organization_id: str = "org-1") -> IntegrationConnector:
    return use_case.create(
        CreateIntegrationConnectorInput(
            name="ERP feed",
            endpoint_url="https://erp.example.com/api",
            source_system="erp",
            organization_id=organization_id,
            workspace_id="ws-1",
            connector_type="http",
            method="GET",
            auth_type="bearer",
            secret_value="topsecret",
        )
    )


class TestUpdateIntegrationConnector:
    def test_partial_update_only_touches_provided_fields(self):
        use_case, _, _ = _make_use_case()
        created = _create_http(use_case)

        updated = use_case.update(
            UpdateIntegrationConnectorInput(
                connector_id=created.id,
                organization_id="org-1",
                name="ERP feed (prod)",
                timeout_seconds=60,
            )
        )

        assert updated.id == created.id
        assert updated.name == "ERP feed (prod)"
        assert updated.timeout_seconds == 60
        # Untouched fields preserved
        assert updated.endpoint_url == "https://erp.example.com/api"
        assert updated.method == "GET"
        assert updated.auth_type == "bearer"
        assert updated.secret_ref == "sealed:topsecret"
        assert updated.connector_type == "http"
        assert updated.workspace_id == "ws-1"

    def test_secret_value_reseals_via_resolver(self):
        use_case, _, resolver = _make_use_case()
        created = _create_http(use_case)

        # Reset the recorder to focus on the update call
        resolver.seal_calls.clear()

        updated = use_case.update(
            UpdateIntegrationConnectorInput(
                connector_id=created.id,
                organization_id="org-1",
                secret_value="rotated-key",
            )
        )

        assert resolver.seal_calls == ["rotated-key"]
        assert updated.secret_ref == "sealed:rotated-key"

    def test_update_disables_connector(self):
        use_case, _, _ = _make_use_case()
        created = _create_http(use_case)

        updated = use_case.update(
            UpdateIntegrationConnectorInput(
                connector_id=created.id,
                organization_id="org-1",
                is_enabled=False,
            )
        )

        assert updated.is_enabled is False

    def test_update_rejects_when_credential_id_combined_with_secret_value(self):
        use_case, _, _ = _make_use_case()
        created = _create_http(use_case)

        with pytest.raises(ValidationError):
            use_case.update(
                UpdateIntegrationConnectorInput(
                    connector_id=created.id,
                    organization_id="org-1",
                    credential_id="cred-1",
                    secret_value="should-not-coexist",
                )
            )

    def test_update_not_found_raises(self):
        use_case, _, _ = _make_use_case()

        with pytest.raises(ValidationError) as exc_info:
            use_case.update(
                UpdateIntegrationConnectorInput(
                    connector_id="icn-missing",
                    organization_id="org-1",
                    name="should never apply",
                )
            )

        assert "not found" in str(exc_info.value).lower()

    def test_update_respects_organization_scope(self):
        """An admin from another org cannot update this connector."""
        use_case, _, _ = _make_use_case()
        created = _create_http(use_case)

        with pytest.raises(ValidationError) as exc_info:
            use_case.update(
                UpdateIntegrationConnectorInput(
                    connector_id=created.id,
                    organization_id="org-99",
                    name="cross-tenant attempt",
                )
            )

        assert "not found" in str(exc_info.value).lower()


class TestDeleteIntegrationConnector:
    def test_delete_removes_connector(self):
        use_case, repo, _ = _make_use_case()
        created = _create_http(use_case)

        use_case.delete(created.id, organization_id="org-1")

        assert repo.get(created.id, organization_id="org-1") is None

    def test_delete_not_found_raises(self):
        use_case, _, _ = _make_use_case()

        with pytest.raises(ValidationError) as exc_info:
            use_case.delete("icn-missing", organization_id="org-1")

        assert "not found" in str(exc_info.value).lower()

    def test_delete_respects_organization_scope(self):
        use_case, repo, _ = _make_use_case()
        created = _create_http(use_case)

        with pytest.raises(ValidationError):
            use_case.delete(created.id, organization_id="org-99")

        # Still there for the legitimate owner
        assert repo.get(created.id, organization_id="org-1") is not None
