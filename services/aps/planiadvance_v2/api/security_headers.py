"""Security response headers middleware.

Adds a small set of headers that browsers use to harden any HTML / JSON
response served by the API. These are sane defaults — the pilot
operator can layer their own reverse proxy and add more (e.g. CSP,
X-DNS-Prefetch-Control). Strict-Transport-Security is only added when
the request was already HTTPS, so an HTTP-only dev install does not
get a sticky HSTS pin from a single visit.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

_DEFAULT_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}

_HSTS_HEADER = ("Strict-Transport-Security", "max-age=31536000; includeSubDomains")


def _is_https_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto and forwarded_proto.split(",")[0].strip().lower() == "https":
        return True
    return False


async def security_headers_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    response = await call_next(request)
    for name, value in _DEFAULT_HEADERS.items():
        # Don't clobber a header an upstream component (FastAPI itself,
        # a route, or a wrapped middleware) intentionally set.
        response.headers.setdefault(name, value)
    if _is_https_request(request):
        response.headers.setdefault(*_HSTS_HEADER)
    return response


def install_security_headers(app: FastAPI) -> None:
    app.middleware("http")(security_headers_middleware)
