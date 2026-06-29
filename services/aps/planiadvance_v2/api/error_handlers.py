"""Translate domain exceptions into HTTP responses.

Keeping this translation in the API layer means the domain layer remains
pure — it raises semantic exceptions, not HTTP status codes.
"""

from __future__ import annotations

import logging
import traceback
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ..domain.errors import (
    DomainError,
    InfeasibleScheduleError,
    UnknownResourceError,
    ValidationError,
)

_logger = logging.getLogger("planiadvance.api.errors")


def _error_payload(
    *,
    error: str,
    message: str,
    details: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {"error": error, "message": message}
    if details:
        payload["details"] = details
    return payload


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ValidationError)
    async def _validation(_: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                error="validation_error",
                message=str(exc),
            ),
        )

    @app.exception_handler(UnknownResourceError)
    async def _unknown(_: Request, exc: UnknownResourceError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                error="invalid_reference",
                message=str(exc),
            ),
        )

    @app.exception_handler(InfeasibleScheduleError)
    async def _infeasible(_: Request, exc: InfeasibleScheduleError) -> JSONResponse:
        payload = _error_payload(
            error="infeasible_schedule",
            message=str(exc),
        )
        if exc.report is not None:
            payload["details"] = [exc.report.as_dict()]
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=_error_payload(error="domain_error", message=str(exc)),
        )

    @app.exception_handler(RequestValidationError)
    async def _request_validation(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {
                "loc": list(error.get("loc", [])),
                "message": error.get("msg", "Invalid value"),
                "type": error.get("type", "value_error"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                error="request_validation_error",
                message="Request payload validation failed.",
                details=details,
            ),
        )

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "error" in detail and "message" in detail:
            return JSONResponse(status_code=exc.status_code, content=detail)
        message = detail if isinstance(detail, str) else "HTTP error"
        error = {
            404: "not_found",
            422: "invalid_request",
        }.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(error=error, message=message),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # J7 S1 — last-resort handler. The full traceback (including the
        # Python exception type and message) goes to the server logs with
        # a short request_id prefix so the operator can grep. The HTTP
        # response intentionally only carries the request_id and a generic
        # message: anything more would leak SQL column names, internal
        # paths, etc to whoever's calling the API.
        request_id = uuid.uuid4().hex[:8]
        tb = traceback.format_exc()
        _logger.error(
            "[req=%s] Unhandled exception on %s %s\n%s",
            request_id,
            request.method,
            request.url.path,
            tb,
        )
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                error="internal_server_error",
                message=(
                    "An unexpected error occurred. Please retry, and if "
                    f"the problem persists share this reference with "
                    f"support: {request_id}"
                ),
            ),
        )
