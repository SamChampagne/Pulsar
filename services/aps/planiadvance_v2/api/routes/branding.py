"""Public branding endpoint used by the UI.

The UI calls this once on boot to learn the deployment's brand name,
short wordmark, and tagline. A pilot operator rebrands by setting the
BRAND_* env vars without touching any code.
"""

from __future__ import annotations

from fastapi import APIRouter

from ...config import get_settings

router = APIRouter(prefix="", tags=["branding"])


@router.get("/branding")
def branding() -> dict:
    settings = get_settings()
    return {
        "name": settings.brand_name,
        "short_name": settings.brand_short_name,
        "tagline": settings.brand_tagline,
        "features": {
            "studio_v2": settings.studio_v2_enabled,
        },
    }
