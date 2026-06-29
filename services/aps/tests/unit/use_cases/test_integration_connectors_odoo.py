from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import IntegrationConnector
from planiadvance_v2.application.use_cases.integration_connectors import (
    VALID_CONNECTOR_TYPES,
    _validated_connector,
    parse_odoo_endpoint,
)
from planiadvance_v2.domain.errors import ValidationError


def _make_odoo_connector(
    *,
    endpoint_url: str = "http://localhost:8069/planiadvance_test",
    auth_type: str = "basic",
    username: str | None = "admin",
    secret_ref: str | None = "env:ODOO_API_KEY",
) -> IntegrationConnector:
    return IntegrationConnector(
        id="icn-odoo-1",
        name="Odoo prod",
        endpoint_url=endpoint_url,
        source_system="odoo-17",
        connector_type="odoo",
        method="POST",
        auth_type=auth_type,
        username=username,
        secret_ref=secret_ref,
    )


class TestOdooConnectorValidation:
    def test_odoo_is_in_valid_connector_types(self):
        assert "odoo" in VALID_CONNECTOR_TYPES

    def test_valid_odoo_connector_passes_validation(self):
        connector = _validated_connector(_make_odoo_connector())
        assert connector.connector_type == "odoo"
        assert connector.endpoint_url == "http://localhost:8069/planiadvance_test"
        assert connector.auth_type == "basic"

    def test_https_scheme_is_accepted(self):
        connector = _validated_connector(
            _make_odoo_connector(endpoint_url="https://erp.example.com/prod_db")
        )
        assert connector.endpoint_url.startswith("https://")

    def test_rejects_non_http_scheme(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(
                _make_odoo_connector(endpoint_url="ftp://localhost:8069/db")
            )
        assert "Odoo" in str(exc_info.value) or "http" in str(exc_info.value).lower()

    def test_rejects_missing_database_path(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(
                _make_odoo_connector(endpoint_url="http://localhost:8069")
            )
        assert "database" in str(exc_info.value).lower()

    def test_rejects_empty_database_path(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(
                _make_odoo_connector(endpoint_url="http://localhost:8069/")
            )
        assert "database" in str(exc_info.value).lower()

    def test_rejects_auth_type_other_than_basic(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(_make_odoo_connector(auth_type="bearer"))
        assert "auth_type" in str(exc_info.value).lower()

    def test_rejects_missing_username(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(_make_odoo_connector(username=None))
        assert "username" in str(exc_info.value).lower()

    def test_rejects_missing_secret_ref(self):
        with pytest.raises(ValidationError) as exc_info:
            _validated_connector(_make_odoo_connector(secret_ref=None))
        assert "secret" in str(exc_info.value).lower()


class TestParseOdooEndpoint:
    def test_extracts_base_url_and_database(self):
        connector = _make_odoo_connector(
            endpoint_url="http://localhost:8069/planiadvance_test"
        )
        base_url, database = parse_odoo_endpoint(connector)
        assert base_url == "http://localhost:8069"
        assert database == "planiadvance_test"

    def test_strips_trailing_slash_from_database_segment(self):
        connector = _make_odoo_connector(
            endpoint_url="http://localhost:8069/my_db/"
        )
        _base_url, database = parse_odoo_endpoint(connector)
        assert database == "my_db"

    def test_handles_https_with_port(self):
        connector = _make_odoo_connector(
            endpoint_url="https://erp.example.com:443/prod"
        )
        base_url, database = parse_odoo_endpoint(connector)
        assert base_url == "https://erp.example.com:443"
        assert database == "prod"

    def test_raises_when_called_on_non_odoo_connector(self):
        connector = IntegrationConnector(
            id="icn-http-1",
            name="HTTP",
            endpoint_url="http://example.com/path",
            source_system="erp",
            connector_type="http",
        )
        with pytest.raises(ValueError) as exc_info:
            parse_odoo_endpoint(connector)
        assert "odoo" in str(exc_info.value).lower()
