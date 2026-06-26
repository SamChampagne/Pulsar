"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Global application settings.

    All values are loaded from environment variables or a local ``.env`` file.
    Keeping settings in one immutable object makes the app easy to test and
    avoids scattered ``os.environ`` lookups across the codebase.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://plani:plani@localhost:5432/planiadvance_v2"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    log_level: str = "INFO"
    seed_dataset: str = "demo"
    seed_reset: bool = True
    seed_organization_id: str = "org-demo"
    seed_organization_name: str = "Demo Organization"
    seed_organization_slug: str = "demo"
    seed_user_id: str = "user-1"
    seed_user_email: str = "planner@demo.local"
    seed_user_display_name: str = "Demo Planner"
    seed_workspace_id: str = "default"
    seed_workspace_name: str = "Default Workspace"

    scheduling_horizon_days: int = 30
    default_heuristic: str = "edd"
    integration_api_key: str | None = None
    integration_read_api_key: str | None = None
    integration_run_api_key: str | None = None
    integration_max_csv_bytes: int = 2_000_000
    integration_max_work_orders: int = 10_000
    integration_max_operations: int = 50_000
    integration_rate_limit_per_minute: int = 120
    integration_worker_interval_seconds: int = 60
    integration_worker_batch_limit: int = 50
    integration_worker_lock_ttl_seconds: int = 900
    integration_worker_id: str | None = None
    integration_secret_key: str | None = None
    auth_session_secret: str | None = None
    auth_session_ttl_hours: int = 12
    auth_allow_header_identity: bool = True
    auth_selector_login_enabled: bool = True
    auth_expose_login_directory: bool = True
    # J7 S2 — per-source-IP cap on POST /auth/login. Throttles credential
    # stuffing / DoS attempts without locking out the legit planner. Set
    # to 0 to disable (not recommended on a pilot exposed to the public).
    auth_login_rate_limit_per_minute: int = 30
    # V1.2 P3 webhook ingress — per-token rate limit. Keys the bucket
    # on the URL token so each vendor hits its own quota (a chatty
    # Odoo doesn't burn an MES connector's allowance). 60/min is the
    # baseline Stripe/GitHub use for inbound webhooks; bump for a
    # high-frequency MES, set to 0 to disable on private deployments.
    webhook_rate_limit_per_minute: int = 60
    # Real-auth slice 1. When True, /auth/login refuses a request that
    # does not carry a password and verifies it against the stored
    # bcrypt hash on the user account. Default False keeps the legacy
    # selector-login flow alive until the UI and seed both ship a
    # password story (slice 2 + 3). Flip to True via env once the
    # demo user has a hash on file.
    auth_require_password: bool = False
    auth_password_cost: int = 12
    # Real-auth slice 6: minimum password length enforced server-side
    # by check_password_policy. NIST recommends >= 8; we default to 8
    # so the demo seed "demo" must be replaced before the operator can
    # turn AUTH_REQUIRE_PASSWORD on (or the seed gets stamped via the
    # admin endpoint with a real password first).
    auth_password_min_length: int = 8
    # Seed-only — bootstrap will hash this and stamp it on the demo
    # user account when auth_require_password is True. Production
    # deployments override per user via the admin API (slice 3).
    # Default chosen to satisfy auth_password_min_length=8 so an
    # operator who flips the require-password flag right away isn't
    # stuck with a seed password the policy refuses.
    auth_seed_password: str = "demo-pass"
    # When True (default), bootstrap shifts the seed dataset's hard-coded
    # 2026-01-05 anchor to the next Monday from today, so a pilot booted
    # in May sees a current-looking workshop instead of WOs four months
    # past due. Test datasets stay deterministic because tests call the
    # factories directly, not through bootstrap.
    seed_anchor_to_today: bool = True
    # J5 — branding override. Surfaces in the UI's <title>, AppShell
    # wordmark, login hero subtitle. Defaults preserve the current
    # "PlaniAdvance" wordmark; a pilot operator can rebrand without
    # touching code.
    brand_name: str = "PlaniAdvance"
    brand_short_name: str = "PA"
    brand_tagline: str = (
        "Industrial production planning. Scheduling, Gantt edits, "
        "scenarios and reports in one cockpit."
    )
    reports_html_preview_enabled: bool = False
    studio_v2_enabled: bool = True
    cors_allow_origins: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:4173,"
        "http://127.0.0.1:4173"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings instance (singleton)."""
    return Settings()
