"""HTTP transport and secret resolution for integration connectors."""

from __future__ import annotations

import os
import secrets
from base64 import urlsafe_b64decode, urlsafe_b64encode
from hashlib import sha256
from hmac import compare_digest
from hmac import new as hmac_new
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ..application.ports import (
    IntegrationHttpRequest,
    IntegrationHttpResponse,
)
from ..config import get_settings
from ..domain.errors import ValidationError

_RUNTIME_INTEGRATION_SECRET = secrets.token_bytes(32)


class EnvIntegrationSecretResolver:
    def resolve(self, secret_ref: str) -> str:
        if secret_ref.startswith("env:"):
            return self._resolve_env(secret_ref)
        if secret_ref.startswith("sealed:"):
            return self._unseal(secret_ref[7:].strip())
        raise ValidationError(
            "Integration secret_ref must use env:NAME or a stored app secret."
        )

    def seal(self, secret_value: str) -> str:
        value = secret_value.strip()
        if not value:
            raise ValidationError("Integration connector credential value is required.")
        key = _integration_secret_key()
        nonce = secrets.token_bytes(16)
        plaintext = value.encode("utf-8")
        ciphertext = _xor_with_keystream(plaintext, key=key, nonce=nonce)
        signature = hmac_new(key, nonce + ciphertext, sha256).digest()
        token = _urlsafe_b64encode(nonce + signature + ciphertext)
        return f"sealed:{token}"

    def _resolve_env(self, secret_ref: str) -> str:
        env_name = secret_ref[4:].strip()
        if not env_name:
            raise ValidationError("Integration secret_ref env name is required.")
        value = os.environ.get(env_name)
        if value is None:
            raise ValidationError(
                f"Integration secret environment variable {env_name!r} is not set."
            )
        return value

    def _unseal(self, token: str) -> str:
        raw = _urlsafe_b64decode(token)
        if len(raw) < 48:
            raise ValidationError("Stored integration secret is invalid.")
        nonce = raw[:16]
        signature = raw[16:48]
        ciphertext = raw[48:]
        key = _integration_secret_key()
        expected_signature = hmac_new(key, nonce + ciphertext, sha256).digest()
        if not compare_digest(signature, expected_signature):
            raise ValidationError("Stored integration secret failed verification.")
        plaintext = _xor_with_keystream(ciphertext, key=key, nonce=nonce)
        return plaintext.decode("utf-8")


def _integration_secret_key() -> bytes:
    settings = get_settings()
    configured = settings.integration_secret_key or settings.auth_session_secret
    if configured:
        return sha256(configured.encode("utf-8")).digest()
    return _RUNTIME_INTEGRATION_SECRET


def _xor_with_keystream(payload: bytes, *, key: bytes, nonce: bytes) -> bytes:
    chunks: list[bytes] = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < len(payload):
        block = hmac_new(key, nonce + counter.to_bytes(4, "big"), sha256).digest()
        chunks.append(block)
        counter += 1
    keystream = b"".join(chunks)[: len(payload)]
    return bytes(left ^ right for left, right in zip(payload, keystream, strict=True))


def _urlsafe_b64encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _urlsafe_b64decode(encoded: str) -> bytes:
    padding = "=" * (-len(encoded) % 4)
    return urlsafe_b64decode((encoded + padding).encode("ascii"))


class UrllibIntegrationHttpTransport:
    def send(self, request: IntegrationHttpRequest) -> IntegrationHttpResponse:
        raw = Request(
            request.url,
            data=request.body,
            method=request.method,
            headers=dict(request.headers),
        )
        try:
            with urlopen(raw, timeout=request.timeout_seconds) as response:
                return IntegrationHttpResponse(
                    status_code=response.getcode(),
                    headers={key: value for key, value in response.headers.items()},
                    body=response.read(),
                )
        except HTTPError as exc:
            return IntegrationHttpResponse(
                status_code=exc.code,
                headers={key: value for key, value in exc.headers.items()},
                body=exc.read(),
            )
