"""Port: resolve secret references for integration connectors."""

from __future__ import annotations

from typing import Protocol


class IntegrationSecretResolver(Protocol):
    def resolve(self, secret_ref: str) -> str: ...

    def seal(self, secret_value: str) -> str: ...
