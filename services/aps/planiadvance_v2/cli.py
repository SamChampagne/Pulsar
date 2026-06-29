"""Command-line entrypoint.

The CLI exists so operators and developers can exercise the APS engine
*without* spinning up a DB or the API. It is also the cleanest way to
demonstrate that the engine is infrastructure-independent.

Usage::

    planiadvance schedule --demo
    planiadvance schedule --demo --heuristic spt
    planiadvance schedule --demo --output schedule.json
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import typer

from .application.use_cases import RunScheduling
from .application.use_cases.run_scheduling import RunSchedulingInput
from .config import get_settings
from .domain.entities import Schedule
from .infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from .infrastructure.integration_automation_worker import (
    IntegrationAutomationWorkerConfig,
    create_sql_integration_automation_worker,
    output_to_json,
)
from .infrastructure.seed import build_seed_dataset

app = typer.Typer(help="PlaniAdvance V2 — industrial APS engine CLI")
automations_app = typer.Typer(help="Integration automation worker commands")
app.add_typer(automations_app, name="automations")


@app.command()
def schedule(
    demo: bool = typer.Option(False, "--demo", help="Use the built-in demo dataset"),
    dataset_name: str = typer.Option(
        "demo",
        "--dataset",
        help="Built-in dataset: demo or industrial",
    ),
    heuristic: str = typer.Option("edd", "--heuristic", "-h", help="edd, priority_edd, spt, critical_ratio"),
    strategy: str = typer.Option("auto", "--strategy", help="greedy, backward, hybrid, auto, ..."),
    horizon_days: int = typer.Option(14, "--horizon-days", help="Planning horizon in days"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Write schedule JSON to this file"),
) -> None:
    """Run a scheduling pass and print the result as JSON."""
    if not demo:
        typer.echo(
            "Only --demo mode is supported by the CLI for now. "
            "Use the API (/scheduling/run) for database-backed runs.",
            err=True,
        )
        raise typer.Exit(code=2)

    dataset = build_seed_dataset(dataset_name)

    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(seed=dataset.work_orders),
        machines=InMemoryMachineRepository(seed=dataset.machines),
        calendars=InMemoryCalendarRepository(seed=dataset.calendars),
        resources=InMemoryResourceRepository(seed=dataset.resources),
        inventory=InMemoryInventoryRepository(seed=dataset.inventory_items),
        supplies=InMemorySupplyRepository(seed=dataset.supplies),
        schedules=InMemoryScheduleRepository(),
    )
    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=dataset.horizon_start,
            horizon_days=horizon_days,
            heuristic=heuristic,
            strategy=strategy,
            transfer_times=dataset.transfer_times,
            persist=False,
        )
    )

    payload = {
        "schedule_id": result.schedule.id,
        "dataset": dataset.name,
        "created_at": result.schedule.created_at.isoformat(),
        "assignments": _assignments_json(result.schedule),
        "metrics": result.metrics,
        "summary": result.summary.as_dict() if result.summary else None,
        "diagnostics": result.diagnostics,
    }

    text = json.dumps(payload, indent=2, default=str)
    if output:
        output.write_text(text, encoding="utf-8")
        typer.echo(f"Wrote {output}")
    else:
        typer.echo(text)


@app.command()
def seed(
    dataset_name: str = typer.Option(
        "demo",
        "--dataset",
        help="Built-in dataset: demo or industrial",
    ),
) -> None:
    """Print the demo dataset shape (work orders, machines, calendars)."""
    dataset = build_seed_dataset(dataset_name)
    typer.echo(
        json.dumps(
            {
                "dataset": dataset.name,
                "calendars": [c.id for c in dataset.calendars],
                "machines": [m.id for m in dataset.machines],
                "resources": [r.id for r in dataset.resources],
                "inventory_items": [item.material_id for item in dataset.inventory_items],
                "supplies": [lot.id for lot in dataset.supplies],
                "work_orders": [
                    {"id": wo.id, "operations": [o.id for o in wo.operations]}
                    for wo in dataset.work_orders
                ],
            },
            indent=2,
        )
    )


@automations_app.command("run-due")
def run_due_automations(
    loop: bool = typer.Option(
        False,
        "--loop",
        help="Keep polling due scheduled automations instead of running once.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Report due jobs without executing them.",
    ),
    interval_seconds: float | None = typer.Option(
        None,
        "--interval-seconds",
        help="Worker polling interval; defaults to INTEGRATION_WORKER_INTERVAL_SECONDS.",
    ),
    limit: int | None = typer.Option(
        None,
        "--limit",
        help="Maximum jobs checked per pass; defaults to INTEGRATION_WORKER_BATCH_LIMIT.",
    ),
    organization_id: str | None = typer.Option(
        None,
        "--organization-id",
        help="Optional company scope. Omit to scan all persisted jobs.",
    ),
    workspace_id: str | None = typer.Option(
        None,
        "--workspace-id",
        help="Optional workspace scope. Omit to scan all persisted jobs in scope.",
    ),
    max_iterations: int | None = typer.Option(
        None,
        "--max-iterations",
        help="Stop after N loop passes. Mainly useful for smoke tests.",
    ),
    worker_id: str | None = typer.Option(
        None,
        "--worker-id",
        help="Stable worker identity used for automation locks.",
    ),
    lock_ttl_seconds: int | None = typer.Option(
        None,
        "--lock-ttl-seconds",
        help="How long a claimed automation lock remains valid.",
    ),
) -> None:
    """Execute due scheduled integration automation jobs."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())
    config = IntegrationAutomationWorkerConfig(
        poll_interval_seconds=(
            interval_seconds
            if interval_seconds is not None
            else settings.integration_worker_interval_seconds
        ),
        limit=limit if limit is not None else settings.integration_worker_batch_limit,
        dry_run=dry_run,
        organization_id=organization_id,
        workspace_id=workspace_id,
        worker_id=worker_id or settings.integration_worker_id,
        lock_ttl_seconds=(
            lock_ttl_seconds
            if lock_ttl_seconds is not None
            else settings.integration_worker_lock_ttl_seconds
        ),
        max_iterations=max_iterations,
    )
    worker = create_sql_integration_automation_worker(config)
    if loop:
        worker.run_loop()
        return

    output = worker.run_once()
    typer.echo(output_to_json(output))


def _assignments_json(schedule: Schedule) -> list[dict]:
    return [
        {
            "operation_id": a.operation_id,
            "work_order_id": a.work_order_id,
            "machine_id": a.machine_id,
            "setup_start": a.setup_start.isoformat(),
            "start": a.start.isoformat(),
            "end": a.end.isoformat(),
        }
        for a in schedule.assignments
    ]


def main() -> None:  # pragma: no cover - thin entry point
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
