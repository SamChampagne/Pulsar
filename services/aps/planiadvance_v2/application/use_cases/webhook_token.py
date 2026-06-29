"""V1.2 P3 — deterministic webhook token derived from (flow_id, block_id).

Shared between the use-case layer (where ``trigger_webhook`` blocks
emit the token in their output_payload so the Studio UI can copy
the URL) and the public webhook ingress route (which reverses the
mapping to dispatch the flow).

The token is NOT a secret. It's a stable opaque slug — its only job
is to avoid leaking the raw flow_id in URLs. The HMAC signature
header is what actually authenticates a webhook caller.

Same (flow_id, block_id) → same token across reloads + across
runs, so the URL the Studio shows in the Inspector stays valid for
the lifetime of the block.
"""

from __future__ import annotations

import hashlib


def webhook_token_for(*, flow_id: str, block_id: str) -> str:
    digest = hashlib.sha256(f"{flow_id}:{block_id}".encode()).hexdigest()
    return digest[:16]
