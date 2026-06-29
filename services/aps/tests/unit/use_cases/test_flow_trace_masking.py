"""Studio v2 phase 3 — server-side mask of sensitive keys before
trace payloads ship to the UI."""

from __future__ import annotations

from planiadvance_v2.application.use_cases._flow_trace_masking import mask_payload


def test_mask_payload_redacts_authorization_header() -> None:
    out = mask_payload({"headers": {"Authorization": "Bearer abc123"}})
    assert out == {"headers": {"Authorization": "***"}}


def test_mask_payload_redacts_password_and_token_keys_recursively() -> None:
    out = mask_payload(
        {"data": {"user": "x", "password": "y", "nested": {"api_token": "z"}}}
    )
    assert out == {
        "data": {"user": "x", "password": "***", "nested": {"api_token": "***"}}
    }


def test_mask_payload_keeps_non_sensitive_values_intact() -> None:
    out = mask_payload({"work_orders": [{"id": "WO-1", "due": "2026-05-08"}]})
    assert out == {"work_orders": [{"id": "WO-1", "due": "2026-05-08"}]}


def test_mask_payload_handles_lists_of_dicts() -> None:
    out = mask_payload([{"secret": "x"}, {"name": "ok"}])
    assert out == [{"secret": "***"}, {"name": "ok"}]


def test_mask_payload_is_safe_on_non_dict_input() -> None:
    assert mask_payload("plain") == "plain"
    assert mask_payload(None) is None
    assert mask_payload(42) == 42


def test_mask_payload_redacts_x_api_key_header_case_insensitive() -> None:
    out = mask_payload({"X-API-Key": "abc", "x-api-key": "def"})
    assert out == {"X-API-Key": "***", "x-api-key": "***"}


def test_mask_payload_redacts_cookie_header() -> None:
    out = mask_payload({"headers": {"Cookie": "session=xyz"}})
    assert out == {"headers": {"Cookie": "***"}}
