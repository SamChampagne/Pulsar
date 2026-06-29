"""SFTP transport for integration connectors."""

from __future__ import annotations

import posixpath

from ..application.ports import (
    IntegrationSftpPutRequest,
    IntegrationSftpPutResult,
    IntegrationSftpTestRequest,
    IntegrationSftpTestResult,
)
from ..domain.errors import ValidationError


class ParamikoIntegrationSftpTransport:
    def put_file(self, request: IntegrationSftpPutRequest) -> IntegrationSftpPutResult:
        paramiko = _load_paramiko()
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.load_system_host_keys()
        try:
            client.connect(
                hostname=request.host,
                port=request.port,
                username=request.username,
                password=request.password,
                timeout=request.timeout_seconds,
                banner_timeout=request.timeout_seconds,
                auth_timeout=request.timeout_seconds,
                look_for_keys=False,
                allow_agent=False,
            )
            with client.open_sftp() as sftp:
                directory = posixpath.dirname(request.path) or "/"
                _ensure_remote_directory(sftp, directory)
                with sftp.file(request.path, "wb") as handle:
                    handle.write(request.body)
            return IntegrationSftpPutResult(
                path=request.path,
                bytes_written=len(request.body),
            )
        except Exception as exc:  # pragma: no cover - exercised via adapters/integration environments
            raise ValidationError(f"SFTP delivery failed: {exc}") from exc
        finally:
            client.close()

    def test_connection(
        self, request: IntegrationSftpTestRequest
    ) -> IntegrationSftpTestResult:
        paramiko = _load_paramiko()
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.load_system_host_keys()
        try:
            client.connect(
                hostname=request.host,
                port=request.port,
                username=request.username,
                password=request.password,
                timeout=request.timeout_seconds,
                banner_timeout=request.timeout_seconds,
                auth_timeout=request.timeout_seconds,
                look_for_keys=False,
                allow_agent=False,
            )
            with client.open_sftp() as sftp:
                if request.path:
                    sftp.chdir(request.path)
            target = request.path or "/"
            return IntegrationSftpTestResult(
                ok=True,
                message=f"SFTP connection succeeded for {target}.",
                path=request.path,
            )
        except Exception as exc:  # pragma: no cover - exercised via adapters/integration environments
            raise ValidationError(f"SFTP connection failed: {exc}") from exc
        finally:
            client.close()


def _load_paramiko():
    try:
        import paramiko
    except ModuleNotFoundError as exc:  # pragma: no cover - depends on deploy env
        raise ValidationError(
            "SFTP runtime requires the optional 'paramiko' package. "
            "Install PlaniAdvance with the sftp extra on the server."
        ) from exc
    return paramiko


def _ensure_remote_directory(sftp, directory: str) -> None:
    normalized = directory or "/"
    if normalized in {"", "/"}:
        return
    current = "/"
    for part in normalized.split("/"):
        if not part:
            continue
        current = posixpath.join(current, part)
        try:
            sftp.stat(current)
        except OSError:
            sftp.mkdir(current)
