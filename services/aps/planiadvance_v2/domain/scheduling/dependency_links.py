"""Helpers for structured operation dependency links."""

from __future__ import annotations

from ..entities import DependencyLink, DependencyType, Operation, WorkOrder


def implicit_sequence_link(previous_operation_id: str) -> DependencyLink:
    """Build the legacy in-work-order finish-to-start chain link."""

    return DependencyLink(
        depends_on_id=previous_operation_id,
        dependency_type=DependencyType.FINISH_TO_START,
    )


def operation_dependency_links(
    work_order: WorkOrder,
    operation: Operation,
) -> list[DependencyLink]:
    """Return explicit + implicit dependency links for one operation."""

    links = list(operation.effective_dependency_links())
    seen = {(link.depends_on_id, link.dependency_type.value) for link in links}
    previous = None
    for candidate in work_order.ordered_operations():
        if candidate.sequence >= operation.sequence:
            break
        previous = candidate
    if previous is not None:
        link = implicit_sequence_link(previous.id)
        key = (link.depends_on_id, link.dependency_type.value)
        if key not in seen:
            links.append(link)
    return links


def dependency_ids_for_operation(
    work_order: WorkOrder,
    operation: Operation,
) -> list[str]:
    """Return predecessor ids for ordering / cycle checks."""

    ordered: list[str] = []
    seen: set[str] = set()
    for link in operation_dependency_links(work_order, operation):
        if link.depends_on_id in seen:
            continue
        seen.add(link.depends_on_id)
        ordered.append(link.depends_on_id)
    return ordered
