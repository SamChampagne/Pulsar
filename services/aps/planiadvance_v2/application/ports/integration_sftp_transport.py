"""Port: execute outbound SFTP delivery for integration connectors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class IntegrationSftpPutRequest:
    host: str
    port: int
    username: str
    password: str
    path: str
    body: bytes
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationSftpPutResult:
    path: str
    bytes_written: int


@dataclass(frozen=True, slots=True)
class IntegrationSftpTestRequest:
    host: str
    port: int
    username: str
    password: str
    path: str | None = None
    timeout_seconds: int = 30


@dataclass(frozen=True, slots=True)
class IntegrationSftpTestResult:
    ok: bool
    message: str
    path: str | None = None


class IntegrationSftpTransport(Protocol):
    def put_file(self, request: IntegrationSftpPutRequest) -> IntegrationSftpPutResult: ...

    def test_connection(
        self, request: IntegrationSftpTestRequest
    ) -> IntegrationSftpTestResult: ...
