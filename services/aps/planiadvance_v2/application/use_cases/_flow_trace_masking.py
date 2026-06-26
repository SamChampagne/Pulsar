"""Studio v2 phase 3 — server-side masking of sensitive keys before
trace payloads ship to the UI.

Defense in depth: the UI cannot un-mask. The mask runs once at the
boundary between the runner and the persistence layer, so traces in
``integration_flow_run_traces`` never contain the raw secret.

Patterns matched (case-insensitive substring):
    authorization, cookie, x-api-key, api-key, api_key,
    password, secret, token

If a key matches, its value is replaced with ``"***"``. Other values
are recursively walked. Strings, bytes, numbers, ``None`` are leaves.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

_SENSITIVE_KEY_RE = re.compile(
    r"(?i)(authorization|cookie|x-api-key|api[-_]?key|password|secret|token)"
)
_REDACTED = "***"


def mask_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            k: _REDACTED if _SENSITIVE_KEY_RE.search(str(k)) else mask_payload(v)
            for k, v in value.items()
        }
    if isinstance(value, (str, bytes)):
        return value
    if isinstance(value, Sequence):
        return [mask_payload(v) for v in value]
    return value
