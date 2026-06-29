"""Runtime adapter for database delivery using SQLAlchemy."""

from __future__ import annotations

from typing import Any

from sqlalchemy import MetaData, Table, create_engine, inspect, update
from sqlalchemy.engine import Engine, make_url

from ..application.ports import (
    IntegrationDatabaseColumnSchema,
    IntegrationDatabaseSchemaRequest,
    IntegrationDatabaseSchemaResult,
    IntegrationDatabaseTableSchema,
    IntegrationDatabaseTestRequest,
    IntegrationDatabaseTestResult,
    IntegrationDatabaseWriteRequest,
    IntegrationDatabaseWriteResult,
)
from ..domain.errors import ValidationError


class SqlAlchemyIntegrationDatabaseTransport:
    def write_rows(
        self,
        request: IntegrationDatabaseWriteRequest,
    ) -> IntegrationDatabaseWriteResult:
        if not request.table_name.strip():
            raise ValidationError("Database delivery requires a target table_name.")
        operation = request.operation.strip().lower() or "insert"
        if operation not in {"insert", "update", "upsert"}:
            raise ValidationError(
                f"Unsupported database delivery operation {request.operation!r}."
            )
        if operation in {"update", "upsert"} and not request.match_columns:
            raise ValidationError(
                "Database update and upsert operations require at least one match column."
            )

        engine = self._create_engine(request.url)
        try:
            metadata = MetaData()
            schema_name, table_name = _split_table_name(request.table_name)
            table = Table(table_name, metadata, schema=schema_name, autoload_with=engine)
            inserted = 0
            updated_count = 0
            with engine.begin() as connection:
                if operation == "insert":
                    if request.rows:
                        connection.execute(table.insert(), request.rows)
                    inserted = len(request.rows)
                else:
                    for row in request.rows:
                        _validate_row_match_columns(row, request.match_columns)
                        assignments = {
                            key: value
                            for key, value in row.items()
                            if key not in request.match_columns
                        }
                        statement = update(table).where(
                            *[table.c[column] == row[column] for column in request.match_columns]
                        )
                        if assignments:
                            statement = statement.values(**assignments)
                        result = connection.execute(statement)
                        affected = int(result.rowcount or 0)
                        if operation == "upsert" and affected == 0:
                            connection.execute(table.insert(), [row])
                            inserted += 1
                        else:
                            updated_count += affected
            return IntegrationDatabaseWriteResult(
                table_name=request.table_name,
                operation=operation,
                rows_received=len(request.rows),
                rows_written=inserted + updated_count,
                rows_inserted=inserted,
                rows_updated=updated_count,
                dialect=engine.dialect.name,
                database=engine.url.database,
            )
        finally:
            engine.dispose()

    def test_connection(
        self,
        request: IntegrationDatabaseTestRequest,
    ) -> IntegrationDatabaseTestResult:
        engine = self._create_engine(request.url)
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
            return IntegrationDatabaseTestResult(
                ok=True,
                message=(
                    f"Database connection succeeded for {engine.dialect.name}"
                    f"{f'/{engine.url.database}' if engine.url.database else ''}."
                ),
                dialect=engine.dialect.name,
                database=engine.url.database,
            )
        finally:
            engine.dispose()

    def inspect_schema(
        self,
        request: IntegrationDatabaseSchemaRequest,
    ) -> IntegrationDatabaseSchemaResult:
        engine = self._create_engine(request.url)
        try:
            inspector = inspect(engine)
            default_schema = getattr(inspector, "default_schema_name", None)
            discovered: list[IntegrationDatabaseTableSchema] = []
            for schema_name, table_name in _iter_database_tables(
                inspector=inspector,
                dialect_name=engine.dialect.name,
            ):
                try:
                    columns = inspector.get_columns(table_name, schema=schema_name)
                except Exception:
                    continue
                try:
                    primary_key_columns = set(
                        inspector.get_pk_constraint(table_name, schema=schema_name).get(
                            "constrained_columns"
                        )
                        or []
                    )
                except Exception:
                    primary_key_columns = set()
                normalized_schema_name = _display_schema_name(
                    dialect_name=engine.dialect.name,
                    schema_name=schema_name,
                    default_schema=default_schema,
                )
                full_name = (
                    f"{normalized_schema_name}.{table_name}"
                    if normalized_schema_name
                    else table_name
                )
                discovered.append(
                    IntegrationDatabaseTableSchema(
                        name=table_name,
                        schema_name=normalized_schema_name,
                        full_name=full_name,
                        columns=[
                            IntegrationDatabaseColumnSchema(
                                name=str(column.get("name") or ""),
                                data_type=str(column.get("type") or "unknown"),
                                nullable=bool(column.get("nullable", True)),
                                is_primary_key=str(column.get("name") or "")
                                in primary_key_columns,
                            )
                            for column in columns
                            if str(column.get("name") or "").strip()
                        ],
                    )
                )
            discovered.sort(
                key=lambda item: (
                    item.schema_name or "",
                    item.name,
                )
            )
            return IntegrationDatabaseSchemaResult(
                dialect=engine.dialect.name,
                database=engine.url.database,
                tables=discovered,
            )
        finally:
            engine.dispose()

    @staticmethod
    def _create_engine(url: str) -> Engine:
        connect_args: dict[str, Any] = {}
        parsed = make_url(url)
        if parsed.drivername.startswith("sqlite"):
            connect_args["timeout"] = 30
        return create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)


def _split_table_name(table_name: str) -> tuple[str | None, str]:
    trimmed = table_name.strip()
    if not trimmed:
        raise ValidationError("Database delivery requires a non-empty table_name.")
    if "." not in trimmed:
        return None, trimmed
    schema_name, resolved_table = trimmed.split(".", 1)
    if not schema_name or not resolved_table:
        raise ValidationError("Database table_name must be either 'table' or 'schema.table'.")
    return schema_name, resolved_table


def _validate_row_match_columns(row: dict[str, Any], match_columns: tuple[str, ...]) -> None:
    for column in match_columns:
        if column not in row:
            raise ValidationError(
                f"Database row is missing required match column {column!r}."
            )


def _iter_database_tables(
    *,
    inspector,
    dialect_name: str,
) -> list[tuple[str | None, str]]:
    table_refs: set[tuple[str | None, str]] = set()
    schema_names: list[str | None] = [None]
    try:
        discovered_schemas = inspector.get_schema_names()
    except Exception:
        discovered_schemas = []
    for schema_name in discovered_schemas:
        if not schema_name:
            continue
        if dialect_name == "sqlite" and schema_name.lower().startswith("temp"):
            continue
        if schema_name.lower() == "information_schema":
            continue
        schema_names.append(schema_name)
    for schema_name in schema_names:
        try:
            table_names = inspector.get_table_names(schema=schema_name)
        except Exception:
            continue
        for table_name in table_names:
            table_refs.add((schema_name, table_name))
    return sorted(table_refs, key=lambda item: ((item[0] or ""), item[1]))


def _display_schema_name(
    *,
    dialect_name: str,
    schema_name: str | None,
    default_schema: str | None,
) -> str | None:
    if not schema_name:
        return None
    if schema_name == default_schema:
        return None
    if dialect_name == "sqlite" and schema_name.lower() == "main":
        return None
    return schema_name
