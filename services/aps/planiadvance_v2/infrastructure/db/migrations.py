"""Alembic migration runner used by local dev, Docker and bootstrap."""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config

from alembic import command


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def build_alembic_config(database_url: str) -> Config:
    root = _project_root()
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def run_migrations(database_url: str) -> None:
    config = build_alembic_config(database_url)
    command.upgrade(config, "head")
