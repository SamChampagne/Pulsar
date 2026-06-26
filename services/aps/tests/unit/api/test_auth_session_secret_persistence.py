"""Auth session HMAC key persistence (slice 6, 2026-05-09).

Without an `auth_session_secret` env var, the API generates a random
32-byte key in `auth_sessions._RUNTIME_SESSION_SECRET` at module
import time — i.e. once per process. Restart the container and every
signed-in session token's HMAC stops verifying, forcing every planner
to re-login. This is the friction Sam flagged on 2026-05-09.

These tests pin the contract:
- when `auth_session_secret` is set, _session_secret() returns that
  exact bytes (so tokens survive a restart that uses the same secret),
- when unset, _session_secret() falls back to the runtime random
  secret (so the previous behaviour is unchanged for users who never
  configured the env var).
"""

from __future__ import annotations

from planiadvance_v2.api import auth_sessions
from planiadvance_v2.config import get_settings


def test_session_secret_uses_configured_value(monkeypatch):
    monkeypatch.setattr(
        get_settings(),
        "auth_session_secret",
        "stable-dev-secret-2026-05",
        raising=True,
    )
    assert auth_sessions._session_secret() == b"stable-dev-secret-2026-05"


def test_session_secret_falls_back_to_runtime_random(monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_session_secret", None, raising=True)
    secret = auth_sessions._session_secret()
    assert secret == auth_sessions._RUNTIME_SESSION_SECRET


def test_token_signed_with_configured_secret_verifies_after_module_reload(monkeypatch):
    """Reload-resilience: signing with a configured secret keeps the
    same HMAC key across reloads, so tokens survive a process restart.
    """
    monkeypatch.setattr(
        get_settings(),
        "auth_session_secret",
        "fixed-secret-survives-restart",
        raising=True,
    )
    token, _ = auth_sessions.issue_auth_session(
        user_id="user-1", organization_id="org-1"
    )
    # Force the module-level _RUNTIME_SESSION_SECRET to change as it
    # would on a real restart. The configured secret must still verify.
    monkeypatch.setattr(
        auth_sessions,
        "_RUNTIME_SESSION_SECRET",
        b"some-totally-different-runtime-secret-32",
        raising=True,
    )
    claims = auth_sessions.verify_auth_session(token)
    assert claims.user_id == "user-1"
    assert claims.organization_id == "org-1"
