"""Real-auth slice 1: password hashing + /auth/login verification."""

from __future__ import annotations

import pytest

from planiadvance_v2.api.passwords import hash_password, verify_password


def test_hash_password_round_trip_matches():
    h = hash_password("super-secret-1!")
    assert h != "super-secret-1!"  # not stored in clear
    assert h.startswith("$2")  # bcrypt prefix
    assert verify_password("super-secret-1!", h) is True


def test_verify_password_rejects_wrong_input():
    h = hash_password("alpha")
    assert verify_password("beta", h) is False
    assert verify_password("", h) is False
    assert verify_password("alpha", "") is False
    # Malformed hash should fail closed, not crash.
    assert verify_password("alpha", "not-a-real-hash") is False


def test_hash_password_two_calls_produce_different_hashes():
    """Same plaintext must produce different hashes (salt entropy)."""
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b
    assert verify_password("same-password", a)
    assert verify_password("same-password", b)


def test_hash_password_rejects_empty_string():
    with pytest.raises(ValueError):
        hash_password("")


# NOTE: end-to-end /auth/login wiring (password-required → 422 / 401 /
# 200) is exercised in tests/integration/test_real_stack_postgres.py
# because it needs a real DB and the full FastAPI dependency wiring.
# Here we keep the unit suite focused on the hashing primitives so the
# tests stay sub-second and don't need a Postgres engine.
