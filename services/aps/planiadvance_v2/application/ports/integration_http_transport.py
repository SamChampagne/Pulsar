"""Port: execute outbound HTTP calls for integration connectors."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class IntegrationHttpRequest:
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationHttpResponse:
    status_code: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""


class IntegrationHttpTransport(Protocol):
    def send(self, request: IntegrationHttpRequest) -> IntegrationHttpResponse: ...
