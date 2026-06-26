"""Liveness / readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="", tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "planiadvance_v2"}


@router.get("/ready")
def ready(request: Request) -> dict:
    db_ready = getattr(request.app.state, "db_ready", False)
    return {
        "status": "ready" if db_ready else "degraded",
        "db_ready": db_ready,
    }
