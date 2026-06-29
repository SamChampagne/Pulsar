"""Real-auth slice 6: password complexity rules."""

from __future__ import annotations

import pytest

from planiadvance_v2.api.password_policy import (
    PasswordPolicyError,
    check_password_policy,
)


def test_accepts_strong_enough_password():
    check_password_policy("planner-2026", user_id="user-1", email="p@x")


def test_rejects_too_short():
    with pytest.raises(PasswordPolicyError, match="at least 8"):
        check_password_policy("abc1")


def test_rejects_common_literal():
    with pytest.raises(PasswordPolicyError, match="common-weak"):
        check_password_policy("password")


def test_rejects_matching_user_id():
    with pytest.raises(PasswordPolicyError, match="user id"):
        check_password_policy("longuserid", user_id="LongUserID")


def test_rejects_matching_email_local():
    with pytest.raises(PasswordPolicyError, match="email local"):
        check_password_policy("planner-1", email="planner-1@demo.local")


def test_rejects_single_char_repeat():
    with pytest.raises(PasswordPolicyError, match="two distinct"):
        check_password_policy("aaaaaaaa")


def test_rejects_empty():
    with pytest.raises(PasswordPolicyError, match="empty"):
        check_password_policy("")
