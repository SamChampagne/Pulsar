"""Password hashing and verification helpers.

We use bcrypt directly via the official ``bcrypt`` package — passlib
shows its age (no maintained release in years, broken on Python 3.13
defaults) and we only need two operations:

* ``hash_password(plain)`` — produce a salted bcrypt hash for storage
* ``verify_password(plain, hashed)`` — constant-time compare on login

The hash format is the canonical bcrypt "$2b$<cost>$<22-byte-salt>
<31-byte-hash>" string. We keep the work factor at the bcrypt default
(12) — high enough to slow brute force without making a real login
feel sluggish. Tune via ``settings.auth_password_cost`` if the
deployment needs to push it higher.
"""

from __future__ import annotations

import bcrypt

from ..config import get_settings


def hash_password(plain: str) -> str:
    """Return a salted bcrypt hash for ``plain``."""

    if not plain:
        raise ValueError("password must not be empty")
    cost = _cost_factor()
    salt = bcrypt.gensalt(rounds=cost)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True iff ``plain`` matches the stored bcrypt hash.

    Tolerates a missing or malformed hash by returning False rather
    than raising — a login attempt against an account with no stored
    password should fail closed, never crash."""

    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def _cost_factor() -> int:
    cost = get_settings().auth_password_cost
    # bcrypt accepts 4-31. Clamp defensively so a misconfigured env
    # cannot produce a hash that crashes on verify.
    return max(4, min(int(cost), 16))
