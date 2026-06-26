"""Port: runtime delivery to external databases."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseWriteRequest:
    url: str
    table_name: str
    operation: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    match_columns: tuple[str, ...] = ()
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseWriteResult:
    table_name: str
    operation: str
    rows_received: int
    rows_written: int
    rows_inserted: int = 0
    rows_updated: int = 0
    dialect: str | None = None
    database: str | None = None


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseTestRequest:
    url: str
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseTestResult:
    ok: bool
    message: str
    dialect: str | None = None
    database: str | None = None


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseSchemaRequest:
    url: str
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseColumnSchema:
    name: str
    data_type: str
    nullable: bool = True
    is_primary_key: bool = False


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseTableSchema:
    name: str
    schema_name: str | None = None
    full_name: str | None = None
    columns: list[IntegrationDatabaseColumnSchema] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class IntegrationDatabaseSchemaResult:
    dialect: str | None = None
    database: str | None = None
    tables: list[IntegrationDatabaseTableSchema] = field(default_factory=list)


class IntegrationDatabaseTransport(Protocol):
    def write_rows(
        self,
        request: IntegrationDatabaseWriteRequest,
    ) -> IntegrationDatabaseWriteResult: ...

    def test_connection(
        self,
        request: IntegrationDatabaseTestRequest,
    ) -> IntegrationDatabaseTestResult: ...

    def inspect_schema(
        self,
        request: IntegrationDatabaseSchemaRequest,
    ) -> IntegrationDatabaseSchemaResult: ...
