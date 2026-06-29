"""Operation entity: a single manufacturing step of a work order."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from ..errors import ValidationError
from ..value_objects import Duration, OperationStatus
from .material import MaterialRequirement
from .resource import ResourceRequirement


@dataclass(frozen=True, slots=True)
class RoutingAlternative:
    """One concrete way of performing an operation.

    Real shops almost always have *process alternatives*: a part can be
    made on a big fast machine with more operators, or on a smaller,
    slower one that needs fewer hands. Flattening that into a single
    ``(duration, setup, resources)`` profile per operation costs the
    scheduler the whole trade-off — the reason classical job-shop
    solvers can never model a mixed fleet.

    A :class:`RoutingAlternative` packages everything that changes
    between alternatives for the *same* logical operation:

    ``machine_id``
        The machine this alternative targets. Must belong to
        :class:`Operation.eligible_machine_ids`.
    ``duration``
        Productive run time on that machine (independent of setup).
    ``setup_time``
        Fixed setup cost (a per-machine setup matrix still overrides
        this when :class:`Operation.setup_family` is set).
    ``resource_requirements``
        Secondary resources consumed by this specific alternative.
        Two alternatives on the same machine can require different
        operator counts — the strategies pick the one that fits the
        current resource load.
    """

    machine_id: str
    duration: Duration
    setup_time: Duration = field(default_factory=Duration.zero)
    resource_requirements: tuple[ResourceRequirement, ...] = ()

    def __post_init__(self) -> None:
        if not self.machine_id:
            raise ValidationError("RoutingAlternative.machine_id is required")
        if self.duration.minutes <= 0:
            raise ValidationError(
                f"RoutingAlternative on {self.machine_id}: duration must be > 0"
            )
        seen: set[str] = set()
        for req in self.resource_requirements:
            if req.resource_id in seen:
                raise ValidationError(
                    f"RoutingAlternative on {self.machine_id}: duplicate "
                    f"resource {req.resource_id}"
                )
            seen.add(req.resource_id)


class DependencyType(StrEnum):
    """Supported precedence semantics between two operations."""

    FINISH_TO_START = "finish_to_start"
    START_TO_START = "start_to_start"


@dataclass(frozen=True, slots=True)
class DependencyLink:
    """Structured precedence rule between two operations.

    ``lag_minutes`` may be negative. On a finish-to-start link that means
    the successor may overlap its predecessor by ``abs(lag_minutes)``.
    ``max_wait_minutes`` caps the allowed gap between the predecessor
    reference point and the successor start.
    """

    depends_on_id: str
    dependency_type: DependencyType = DependencyType.FINISH_TO_START
    lag_minutes: int = 0
    max_wait_minutes: int | None = None

    def __post_init__(self) -> None:
        if not self.depends_on_id:
            raise ValidationError("DependencyLink.depends_on_id is required")
        if self.max_wait_minutes is not None and self.max_wait_minutes < 0:
            raise ValidationError(
                "DependencyLink.max_wait_minutes must be >= 0 when provided"
            )


@dataclass(slots=True)
class Operation:
    """A single operation belonging to a work order.

    The entity is deliberately decoupled from scheduling outputs: ``start`` /
    ``end`` / ``machine`` are NOT stored here. That information lives in
    :class:`ScheduledOperation` inside a :class:`Schedule`. This separation
    lets us replan freely without mutating the domain inputs.

    Industrial-grade features
    -------------------------
    ``setup_family``
        Free-form product/tooling family used to look up the machine's
        sequence-dependent setup matrix. When ``None``, the fixed
        ``setup_time`` is used (legacy behaviour).
    ``resource_requirements``
        Secondary resources required by the operation (operators, tools,
        consumables). Enforced by cumulative constraints in the CP-SAT
        strategy. Ignored when ``routings`` is populated — in that case
        each routing carries its own resource list.
    ``material_requirements``
        Input materials consumed by the operation. Phase 1 uses them in
        feasibility checks and canonical integration so the engine can
        reject supply-infeasible runs before solve.
    ``routings``
        Optional list of :class:`RoutingAlternative` entries describing
        process alternatives (big/fast vs small/slow machines, different
        operator counts). When empty, the engine synthesizes one routing
        per eligible machine from the flat ``duration``/``setup_time``/
        ``resource_requirements`` fields — so every legacy instance keeps
        working untouched.
    ``preemptible``
        If ``True``, the operation may be split across several working
        windows of the same machine (e.g. long jobs spanning overnight).
        Non-preemptive by default to preserve backwards compatibility.
    ``min_chunk``
        When preemptible, the minimum duration of a single chunk; avoids
        the pathological case where the solver produces a thousand
        one-minute slices.
    """

    id: str
    work_order_id: str
    sequence: int
    name: str
    duration: Duration
    eligible_machine_ids: list[str]
    setup_time: Duration = field(default_factory=Duration.zero)
    # ``dependencies`` may reference operation ids from ANY work order in the
    # scheduling context, not just the same work order. Cross-WO dependencies
    # are first-class: the scheduler honours them as zero-lag finish-to-start
    # links and raises ``CircularDependencyError`` if a referenced operation
    # is not present in the run. Use this for upstream/downstream coupling
    # across separate work orders (e.g., a packaging WO depending on a
    # production WO completing first).
    dependencies: list[str] = field(default_factory=list)
    dependency_links: list[DependencyLink] = field(default_factory=list)
    status: OperationStatus = OperationStatus.PENDING
    setup_family: str | None = None
    resource_requirements: list[ResourceRequirement] = field(default_factory=list)
    material_requirements: list[MaterialRequirement] = field(default_factory=list)
    routings: list[RoutingAlternative] = field(default_factory=list)
    preemptible: bool = False
    min_chunk: Duration = field(default_factory=Duration.zero)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    remaining_duration: Duration | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Operation.id is required")
        if not self.work_order_id:
            raise ValidationError("Operation.work_order_id is required")
        if self.sequence < 1:
            raise ValidationError(f"Operation.sequence must be >= 1, got {self.sequence}")
        if not self.eligible_machine_ids:
            raise ValidationError(
                f"Operation {self.id} must have at least one eligible machine"
            )
        if self.duration.minutes == 0:
            raise ValidationError(f"Operation {self.id} must have a positive duration")
        if self.id in self.dependencies:
            raise ValidationError(f"Operation {self.id} cannot depend on itself")
        for link in self.dependency_links:
            if link.depends_on_id == self.id:
                raise ValidationError(
                    f"Operation {self.id} cannot depend on itself"
                )
        if self.preemptible and self.min_chunk.minutes > self.duration.minutes:
            raise ValidationError(
                f"Operation {self.id}: min_chunk ({self.min_chunk.minutes}) "
                f"cannot exceed duration ({self.duration.minutes})"
            )
        if self.actual_end is not None and self.actual_start is None:
            raise ValidationError(
                f"Operation {self.id}: actual_end requires actual_start"
            )
        if self.actual_machine_id is not None:
            if self.actual_machine_id not in self.eligible_machine_ids:
                raise ValidationError(
                    f"Operation {self.id}: actual_machine_id "
                    f"{self.actual_machine_id} is not eligible"
                )
            if self.actual_start is None:
                raise ValidationError(
                    f"Operation {self.id}: actual_machine_id requires actual_start"
                )
        if (
            self.actual_start is not None
            and self.actual_end is not None
            and self.actual_end < self.actual_start
        ):
            raise ValidationError(
                f"Operation {self.id}: actual_end cannot be before actual_start"
            )
        if (
            self.remaining_duration is not None
            and self.remaining_duration.minutes > self.duration.minutes
        ):
            raise ValidationError(
                f"Operation {self.id}: remaining_duration "
                f"({self.remaining_duration.minutes}) cannot exceed duration "
                f"({self.duration.minutes})"
            )
        if (
            self.frozen_until is not None
            and self.firm_until is not None
            and self.frozen_until > self.firm_until
        ):
            raise ValidationError(
                f"Operation {self.id}: frozen_until cannot be after firm_until"
            )
        # Guard against duplicate resource ids which would double-count
        # cumulative usage in the solver.
        seen_resources: set[str] = set()
        for req in self.resource_requirements:
            if req.resource_id in seen_resources:
                raise ValidationError(
                    f"Operation {self.id}: duplicate resource requirement "
                    f"{req.resource_id}"
                )
            seen_resources.add(req.resource_id)
        seen_materials: set[str] = set()
        for req in self.material_requirements:
            if req.material_id in seen_materials:
                raise ValidationError(
                    f"Operation {self.id}: duplicate material requirement "
                    f"{req.material_id}"
                )
            seen_materials.add(req.material_id)
        seen_links: set[tuple[str, str]] = set()
        for link in self.effective_dependency_links():
            key = (link.depends_on_id, link.dependency_type.value)
            if key in seen_links:
                raise ValidationError(
                    f"Operation {self.id}: duplicate dependency link "
                    f"{link.depends_on_id} ({link.dependency_type.value})"
                )
            seen_links.add(key)

        # Routing alternatives — when declared, every target machine
        # must belong to ``eligible_machine_ids`` (so downstream code
        # that still reads the flat list sees a consistent world).
        if self.routings:
            eligible = set(self.eligible_machine_ids)
            for alt in self.routings:
                if alt.machine_id not in eligible:
                    raise ValidationError(
                        f"Operation {self.id}: routing targets "
                        f"{alt.machine_id} which is not in eligible_machine_ids"
                    )

    def effective_routings(self) -> list[RoutingAlternative]:
        """Return the operation's routing alternatives.

        When :attr:`routings` is populated it is returned as-is.
        Otherwise a synthetic list is built on the fly — one
        :class:`RoutingAlternative` per eligible machine, all sharing
        the flat ``duration``/``setup_time``/``resource_requirements``
        fields. This is the single entry point every strategy uses
        when enumerating placement candidates, so the legacy flat
        model and the new alternative model share one code path.
        """
        if self.routings:
            return list(self.routings)
        reqs = tuple(self.resource_requirements)
        return [
            RoutingAlternative(
                machine_id=machine_id,
                duration=self.duration,
                setup_time=self.setup_time,
                resource_requirements=reqs,
            )
            for machine_id in self.eligible_machine_ids
        ]

    def effective_dependency_links(self) -> list[DependencyLink]:
        """Return structured dependency links, including legacy shorthand.

        ``dependencies`` remains the backwards-compatible shortcut for a
        zero-lag finish-to-start link. Explicit ``dependency_links`` take
        precedence when both mention the same predecessor.
        """

        links = list(self.dependency_links)
        covered = {link.depends_on_id for link in links}
        for dep_id in self.dependencies:
            if dep_id in covered:
                continue
            links.append(DependencyLink(depends_on_id=dep_id))
        return links

    def dependency_ids(self) -> list[str]:
        """Return all predecessor operation ids without duplicates."""

        ordered: list[str] = []
        seen: set[str] = set()
        for link in self.effective_dependency_links():
            if link.depends_on_id in seen:
                continue
            seen.add(link.depends_on_id)
            ordered.append(link.depends_on_id)
        return ordered

    @property
    def total_processing_time(self) -> Duration:
        """Setup + run time — the full slot required on a machine.

        Note: when a machine-specific setup matrix is in use, this is only
        an upper-bound estimate (the matrix entry may be smaller). Use it
        for sizing, not for exact placement.
        """
        return self.setup_time + self.duration
