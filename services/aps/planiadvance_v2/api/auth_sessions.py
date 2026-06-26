"""Signed planner session helpers."""

from __future__ import annotations

import base64
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from hmac import new as hmac_new

from ..config import get_settings

_RUNTIME_SESSION_SECRET = secrets.token_bytes(32)


@dataclass(frozen=True, slots=True)
class AuthSessionClaims:
    user_id: str
    organization_id: str
    issued_at: datetime
    expires_at: datetime


class InvalidAuthSession(ValueError):
    """Raised when a signed planner session token cannot be trusted."""


def issue_auth_session(
    *,
    user_id: str,
    organization_id: str,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    now = now or datetime.now(UTC)
    expires_at = now + timedelta(hours=get_settings().auth_session_ttl_hours)
    payload = {
        "sub": user_id,
        "org": organization_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    payload_bytes = json.dumps(
        payload,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded_payload = _encode_segment(payload_bytes)
    signature = _sign(payload_bytes)
    return f"v1.{encoded_payload}.{_encode_segment(signature)}", expires_at


def verify_auth_session(
    token: str,
    *,
    now: datetime | None = None,
) -> AuthSessionClaims:
    now = now or datetime.now(UTC)
    try:
        version, encoded_payload, encoded_signature = token.split(".", 2)
    except ValueError as exc:  # pragma: no cover - defensive parsing
        raise InvalidAuthSession("malformed_token") from exc
    if version != "v1":
        raise InvalidAuthSession("unsupported_version")

    payload_bytes = _decode_segment(encoded_payload)
    expected_signature = _sign(payload_bytes)
    provided_signature = _decode_segment(encoded_signature)
    if not compare_digest(provided_signature, expected_signature):
        raise InvalidAuthSession("invalid_signature")

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive parsing
        raise InvalidAuthSession("invalid_payload") from exc

    user_id = str(payload.get("sub") or "").strip()
    organization_id = str(payload.get("org") or "").strip()
    issued_at_epoch = int(payload.get("iat") or 0)
    expires_at_epoch = int(payload.get("exp") or 0)
    if not user_id or not organization_id or expires_at_epoch <= issued_at_epoch:
        raise InvalidAuthSession("invalid_claims")

    issued_at = datetime.fromtimestamp(issued_at_epoch, UTC)
    expires_at = datetime.fromtimestamp(expires_at_epoch, UTC)
    if now >= expires_at:
        raise InvalidAuthSession("expired_token")

    return AuthSessionClaims(
        user_id=user_id,
        organization_id=organization_id,
        issued_at=issued_at,
        expires_at=expires_at,
    )


def hash_auth_session_token(token: str) -> str:
    """SHA-256 hash of a session token, hex-encoded.

    Used by the revocation store so a DB dump cannot be replayed as
    a valid bearer. The hash is a one-way fingerprint — callers
    revoke the hash, the verifier hashes the incoming token and
    checks the store.
    """

    return sha256(token.encode("utf-8")).hexdigest()


def _encode_segment(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_segment(encoded: str) -> bytes:
    padding = "=" * (-len(encoded) % 4)
    try:
        return base64.urlsafe_b64decode(f"{encoded}{padding}".encode("ascii"))
    except Exception as exc:  # pragma: no cover - defensive parsing
        raise InvalidAuthSession("invalid_encoding") from exc


def _sign(payload_bytes: bytes) -> bytes:
    return hmac_new(_session_secret(), payload_bytes, sha256).digest()


def _session_secret() -> bytes:
    configured = get_settings().auth_session_secret
    if configured and configured.strip():
        return configured.strip().encode("utf-8")
    return _RUNTIME_SESSION_SECRET
