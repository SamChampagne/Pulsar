"""Phase 5.5 — cron-to-interval parser used to bridge trigger_schedule
blocks to the existing interval-based automation worker."""

from __future__ import annotations

from planiadvance_v2.application.use_cases.integration_flows import (
    _cron_to_interval_minutes,
)


def test_every_n_minutes():
    assert _cron_to_interval_minutes("*/15 * * * *") == 15
    assert _cron_to_interval_minutes("*/5 * * * *") == 5
    assert _cron_to_interval_minutes("*/1 * * * *") == 1


def test_every_n_hours():
    assert _cron_to_interval_minutes("0 */1 * * *") == 60
    assert _cron_to_interval_minutes("0 */2 * * *") == 120


def test_daily_at_hour():
    assert _cron_to_interval_minutes("0 9 * * *") == 1440


def test_hourly_at_minute():
    assert _cron_to_interval_minutes("17 * * * *") == 60


def test_unsupported_returns_none():
    # Day-of-week filter -> not supported in V1.0 simple parser
    assert _cron_to_interval_minutes("0 9 * * 1-5") is None
    # Day-of-month -> not supported
    assert _cron_to_interval_minutes("0 0 1 * *") is None
    # Empty / wrong shape
    assert _cron_to_interval_minutes("") is None
    assert _cron_to_interval_minutes("not a cron") is None


def test_n_out_of_bounds():
    assert _cron_to_interval_minutes("*/120 * * * *") is None  # > 60 minute interval
    assert _cron_to_interval_minutes("*/0 * * * *") is None
