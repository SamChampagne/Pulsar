from __future__ import annotations

from planiadvance_v2.domain.scheduling import (
    available_strategy_profiles,
    get_strategy_profile,
)


class TestStrategyProfiles:
    def test_core_profiles_exist(self):
        names = [profile.name for profile in available_strategy_profiles()]
        assert "greedy" in names
        assert "backward" in names
        assert "cpsat" in names

    def test_greedy_profile_matches_operational_use(self):
        profile = get_strategy_profile("greedy")
        assert profile is not None
        assert profile.maturity == "production"
        assert profile.recommended_for_disruption is True
        assert profile.supports_preemption is True
        assert profile.supports_frozen_assignments is True

    def test_cpsat_profile_is_not_marked_as_disruption_default(self):
        profile = get_strategy_profile("cpsat")
        assert profile is not None
        assert profile.recommended_for_disruption is False
        assert profile.supports_preemption is False
        assert profile.supports_frozen_assignments is False
