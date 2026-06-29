from __future__ import annotations

from pathlib import Path

from planiadvance_v2.infrastructure.db.migrations import (
    build_alembic_config,
    run_migrations,
)
from planiadvance_v2.infrastructure.db.session import init_schema


class TestAlembicRuntime:
    def test_build_alembic_config_points_to_repo_files(self):
        config = build_alembic_config("postgresql+psycopg://plani:plani@db:5432/app")

        assert Path(config.config_file_name).name == "alembic.ini"
        assert Path(config.get_main_option("script_location")).name == "alembic"
        assert config.get_main_option("sqlalchemy.url") == "postgresql+psycopg://plani:plani@db:5432/app"

    def test_run_migrations_upgrades_to_head(self, monkeypatch):
        calls: list[tuple[str, str]] = []

        def fake_upgrade(config, revision):
            calls.append((config.get_main_option("sqlalchemy.url"), revision))

        monkeypatch.setattr(
            "planiadvance_v2.infrastructure.db.migrations.command.upgrade",
            fake_upgrade,
        )

        run_migrations("postgresql+psycopg://plani:plani@db:5432/app")

        assert calls == [("postgresql+psycopg://plani:plani@db:5432/app", "head")]

    def test_init_schema_delegates_to_migrations(self, monkeypatch):
        calls: list[str] = []

        class DummyEngine:
            url = "postgresql+psycopg://plani:plani@db:5432/app"

        class DummyFactory:
            engine = DummyEngine()

        def fake_run(url: str) -> None:
            calls.append(url)

        monkeypatch.setattr(
            "planiadvance_v2.infrastructure.db.session.run_migrations",
            fake_run,
        )

        init_schema(DummyFactory())

        assert calls == ["postgresql+psycopg://plani:plani@db:5432/app"]
