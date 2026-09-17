"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from ..domain.errors import DomainError
from .error_handlers import register_error_handlers
from .routes import (
    accounts,
    audit,
    auth,
    branding,
    calendars,
    health,
    integration,
    inventory,
    machines,
    planning,
    pulsar,
    reports,
    resources,
    scheduling,
    supplies,
    work_orders,
    workspaces,
)
from .security_headers import install_security_headers


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Apply DB migrations on startup so local Docker/dev stays in sync with
    # the evolving ORM schema.
    from ..infrastructure.db import init_schema

    try:
        init_schema()
    except Exception as exc:  # pragma: no cover - only trips if DB unreachable
        app.state.db_ready = False
        app.state.db_error = str(exc)
    else:
        app.state.db_ready = True
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="PlaniAdvance V2 API",
        version="2.0.0",
        description="Industrial APS engine — clean hexagonal architecture.",
        lifespan=lifespan,
    )
    app.state.settings = settings

    allowed_origins = [
        origin.strip()
        for origin in settings.cors_allow_origins.split(",")
        if origin.strip()
    ]
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # J7 S3 — sane security headers on every response (X-Content-Type-
    # Options, X-Frame-Options, Referrer-Policy, conditional HSTS).
    install_security_headers(app)

    register_error_handlers(app)

    app.include_router(auth.router)
    app.include_router(accounts.router)
    app.include_router(audit.router)
    app.include_router(branding.router)
    app.include_router(health.router)
    app.include_router(calendars.router)
    app.include_router(work_orders.router)
    app.include_router(machines.router)
    app.include_router(resources.router)
    app.include_router(inventory.router)
    app.include_router(supplies.router)
    app.include_router(workspaces.router)
    app.include_router(planning.router)
    app.include_router(pulsar.router)
    app.include_router(scheduling.router)
    app.include_router(integration.router)
    app.include_router(reports.router)

    return app


app = create_app()


# Re-export so tests can import DomainError from here if they prefer.
__all__ = ["app", "create_app", "DomainError"]
