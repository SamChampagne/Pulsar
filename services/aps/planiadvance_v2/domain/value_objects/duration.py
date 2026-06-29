"""Duration value object.

A positive integer number of minutes. Using a value object (rather than a raw
``int``) removes ambiguity ("minutes? seconds? hours?") at call sites and
centralises validation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from ..errors import ValidationError


@dataclass(frozen=True, slots=True)
class Duration:
    minutes: int

    def __post_init__(self) -> None:
        if self.minutes < 0:
            raise ValidationError(f"Duration must be >= 0, got {self.minutes}")

    @classmethod
    def from_minutes(cls, minutes: int) -> Duration:
        return cls(minutes=int(minutes))

    @classmethod
    def from_hours(cls, hours: float) -> Duration:
        return cls(minutes=int(round(hours * 60)))

    @classmethod
    def zero(cls) -> Duration:
        return cls(minutes=0)

    def as_timedelta(self) -> timedelta:
        return timedelta(minutes=self.minutes)

    def __add__(self, other: Duration) -> Duration:
        return Duration(minutes=self.minutes + other.minutes)

    def __bool__(self) -> bool:
        return self.minutes > 0
