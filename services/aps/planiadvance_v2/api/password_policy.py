"""Password complexity rules shared by every credential-mutating route.

Kept deliberately modest — NIST's modern guidance is "length + screen
against breach lists" rather than the legacy class-mix gymnastics.
We enforce length and forbid obviously weak passwords (the seed
default, single-character runs, the user's own id/email). Strength
beyond that is the operator's call via env knobs.

The rule set is overridable from Settings so a pilot can dial it up
or down without a redeploy.
"""

from __future__ import annotations

from ..config import get_settings


class PasswordPolicyError(ValueError):
    """Raised when a candidate password fails the policy."""


_FORBIDDEN_LITERALS = {
    "password",
    "demo",
    "changeme",
    "letmein",
    "qwerty",
    "admin",
    "123456",
    "12345678",
}


def check_password_policy(
    password: str,
    *,
    user_id: str | None = None,
    email: str | None = None,
) -> None:
    """Raise PasswordPolicyError if ``password`` would not be safe to store."""

    settings = get_settings()
    min_length = max(1, int(settings.auth_password_min_length))

    if not password:
        raise PasswordPolicyError("Password must not be empty.")
    if len(password) < min_length:
        raise PasswordPolicyError(
            f"Password must be at least {min_length} characters."
        )
    lowered = password.strip().lower()
    if lowered in _FORBIDDEN_LITERALS:
        raise PasswordPolicyError(
            "Password is on the common-weak list — pick something less guessable."
        )
    if user_id and lowered == user_id.strip().lower():
        raise PasswordPolicyError("Password must differ from the user id.")
    if email:
        email_local = email.split("@", 1)[0].strip().lower()
        if email_local and lowered == email_local:
            raise PasswordPolicyError(
                "Password must differ from the email local part."
            )
    if len(set(password)) < 2:
        raise PasswordPolicyError(
            "Password must use at least two distinct characters."
        )
