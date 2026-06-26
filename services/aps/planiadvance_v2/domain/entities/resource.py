"""Resource entity: a finite-capacity secondary resource.

In the first V2 release, the only constrained resource was the machine (one
exclusive resource = one entity). For an industrial-grade APS we also need
to model *secondary resources* that gate operations without being the
primary machine:

- operator pools (e.g. "2 qualified welders available"),
- tooling / moulds (a mould can only be on one press at a time),
- fixtures, quality gauges,
- consumables (coolant, gas) modelled as cumulative capacity.

A :class:`Resource` has a finite integer capacity. An operation can require
one or more units of any number of resources; the scheduler then guarantees
that at any instant the cumulative usage of each resource stays below its
capacity — exactly like a CP-SAT ``AddCumulative``.

Resources are intentionally decoupled from machines: a machine is itself a
unary resource (capacity 1) with an eligibility rule, while secondary
resources only enforce cumulative capacity. Keeping them separate preserves
the existing Machine abstraction.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import ValidationError


@dataclass(slots=True)
class Resource:
    """A secondary resource with finite integer capacity.

    Parameters
    ----------
    id:
        Stable identifier, referenced by :class:`Operation.resource_requirements`.
    name:
        Human-readable label (shown in diagnostics and Gantt views).
    capacity:
        Maximum number of units simultaneously available. ``1`` means the
        resource is unary/exclusive (e.g. a unique mould), ``>1`` means it
        is cumulative (e.g. a pool of 3 operators).
    calendar_id:
        Optional working calendar. When provided, the resource is only
        available during that calendar's shifts; otherwise it is assumed
        always available (e.g. a passive consumable).
    tags:
        Arbitrary labels used by constraint plugins (skills, qualifications,
        certifications ...).
    """

    id: str
    name: str
    capacity: int
    calendar_id: str | None = None
    tags: list[str] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Resource.id is required")
        if self.capacity <= 0:
            raise ValidationError(
                f"Resource {self.id}: capacity must be > 0, got {self.capacity}"
            )

    def has_tag(self, tag: str) -> bool:
        return tag in self.tags


@dataclass(frozen=True, slots=True)
class ResourceRequirement:
    """How many units of a given resource an operation needs.

    Immutable so it can be safely shared between operations and CP-SAT
    variables without risk of mutation.
    """

    resource_id: str
    units: int = 1

    def __post_init__(self) -> None:
        if not self.resource_id:
            raise ValidationError("ResourceRequirement.resource_id is required")
        if self.units <= 0:
            raise ValidationError(
                f"ResourceRequirement {self.resource_id}: units must be > 0, "
                f"got {self.units}"
            )
