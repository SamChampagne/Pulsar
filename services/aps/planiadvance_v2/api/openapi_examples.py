"""Reusable OpenAPI examples for planner-facing endpoints."""

from __future__ import annotations

RUN_SCHEDULING_EXAMPLES = {
    "baselineGreedyRun": {
        "summary": "Baseline greedy run on the reference workshop",
        "description": (
            "Fast operational run with realistic machine references and transfer times."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "greedy",
            "heuristic": "edd",
            "persist": True,
            "workspace_id": "plant-montreal",
            "scenario_name": "Week 02 operational baseline",
            "lifecycle_status": "draft",
            "transfer_times": {
                "default_minutes": 0,
                "pairs": [
                    {"from_machine": "CUT-1", "to_machine": "ASM-1", "minutes": 20},
                    {"from_machine": "CUT-1", "to_machine": "ASM-2", "minutes": 35},
                ],
            },
        },
    },
    "whatIfCpSatRun": {
        "summary": "Strategic what-if exact run",
        "description": "Use CP-SAT for a deeper what-if evaluation on a small workshop.",
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "cpsat",
            "persist": False,
            "workspace_id": "plant-montreal",
            "scenario_name": "Week 02 what-if exact study",
            "lifecycle_status": "candidate",
            "objective": {
                "makespan": 1,
                "total_tardiness": 10,
                "weighted_tardiness": 0,
                "setup_cost": 1,
                "idle_penalty": 0,
            },
        },
    },
    "autoHybridWhatIfRun": {
        "summary": "Auto what-if using hybrid forward/backward",
        "description": (
            "Let the decision layer choose the operational portfolio: forward greedy "
            "and backward just-in-time are both evaluated, then the best objective wins."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "auto",
            "persist": False,
            "workspace_id": "plant-montreal",
            "scenario_name": "Week 02 auto what-if",
            "lifecycle_status": "what_if",
        },
    },
    "plannerActionRun": {
        "summary": "Run with explicit planner actions",
        "description": (
            "Apply planner intent before solving, such as forcing a machine or "
            "adding a one-off overtime window."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "greedy",
            "persist": False,
            "planner_actions": [
                {
                    "action_type": "force_machine",
                    "operation_id": "WO-1001-01",
                    "machine_id": "CUT-1",
                    "reason": "Planner wants to keep the rush order on the preferred cutter.",
                },
                {
                    "action_type": "add_overtime",
                    "machine_id": "ASM-1",
                    "start": "2026-01-05T17:00:00",
                    "end": "2026-01-05T20:00:00",
                    "reason": "Temporary overtime approved for customer promise.",
                },
            ],
        },
    },
}


COMPARE_STRATEGIES_EXAMPLES = {
    "operationalVsStrategic": {
        "summary": "Operational vs strategic comparison",
        "description": (
            "Compare fast operational strategies with CP-SAT on the same planning window."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategies": ["greedy", "backward", "cpsat"],
            "transfer_times": {
                "default_minutes": 0,
                "pairs": [
                    {"from_machine": "CUT-1", "to_machine": "ASM-1", "minutes": 20},
                    {"from_machine": "CUT-1", "to_machine": "ASM-2", "minutes": 35},
                ],
            },
        },
    }
}


CAPABLE_TO_PROMISE_EXAMPLES = {
    "roughCutPromise": {
        "summary": "Fast rough-cut promise check",
        "description": (
            "Insert a candidate order in infinite-capacity mode to get an early promise date, "
            "quantity-by-date answer and rough capacity picture."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "infinite",
            "finite_validation": False,
            "promise_dates": [
                "2026-01-05T12:00:00",
                "2026-01-06T17:00:00",
            ],
            "candidate_order": {
                "id": "WO-CTP-001",
                "name": "Customer rush promise",
                "product_id": "P-RED",
                "quantity": 10,
                "due_date": "2026-01-06T17:00:00",
                "release_date": "2026-01-05T08:00:00",
                "priority": 1,
                "operations": [
                    {
                        "id": "CTP-CUT",
                        "sequence": 1,
                        "name": "Cut",
                        "duration_minutes": 60,
                        "eligible_machine_ids": ["CUT-1"],
                    },
                    {
                        "id": "CTP-ASM",
                        "sequence": 2,
                        "name": "Assemble",
                        "duration_minutes": 90,
                        "eligible_machine_ids": ["ASM-1", "ASM-2"],
                        "dependencies": ["CTP-CUT"],
                        "setup_family": "RED",
                    },
                ],
            },
            "transfer_times": {
                "default_minutes": 0,
                "pairs": [
                    {"from_machine": "CUT-1", "to_machine": "ASM-1", "minutes": 20},
                    {"from_machine": "CUT-1", "to_machine": "ASM-2", "minutes": 35},
                ],
            },
        },
    },
    "finiteValidatedPromise": {
        "summary": "Rough-cut with finite validation fallback",
        "description": (
            "Ask the engine to confirm a rough-cut promise with the finite greedy scheduler "
            "when rough-cut capacity overlaps are detected."
        ),
        "value": {
            "horizon_start": "2026-01-05T00:00:00",
            "horizon_days": 5,
            "strategy": "infinite",
            "finite_validation": True,
            "finite_strategy": "greedy",
            "candidate_order": {
                "id": "WO-CTP-FINITE-001",
                "name": "Finite checked customer promise",
                "product_id": "P-BLUE",
                "quantity": 4,
                "due_date": "2026-01-06T17:00:00",
                "release_date": "2026-01-05T08:00:00",
                "priority": 1,
                "operations": [
                    {
                        "id": "CTP-FINITE-OP",
                        "sequence": 1,
                        "name": "Machine run",
                        "duration_minutes": 120,
                        "eligible_machine_ids": ["M1"],
                    }
                ],
            },
        },
    },
}


DISRUPTION_EXAMPLES = {
    "machineDown": {
        "summary": "Machine down replanning",
        "description": "Replan after ASM-1 goes down during the first shift.",
        "value": {
            "schedule_id": "schedule-20260105-001",
            "strategy": "greedy",
            "persist": True,
            "workspace_id": "plant-montreal",
            "scenario_name": "Week 02 disruption replay",
            "lifecycle_status": "draft",
            "event": {
                "disruption_type": "machine_down",
                "timestamp": "2026-01-05T12:00:00",
                "machine_id": "ASM-1",
                "event_end": "2026-01-05T17:00:00",
            },
        },
    },
    "rushOrder": {
        "summary": "Rush order insertion",
        "description": "Insert an urgent work order and preserve a new historical run.",
        "value": {
            "schedule_id": "schedule-20260105-001",
            "strategy": "greedy",
            "persist": True,
            "workspace_id": "plant-montreal",
            "scenario_name": "Week 02 rush order replay",
            "lifecycle_status": "draft",
            "event": {
                "disruption_type": "rush_order",
                "timestamp": "2026-01-05T11:00:00",
                "rush_order": {
                    "id": "WO-RUSH",
                    "name": "WO-RUSH",
                    "product_id": "P-RUSH",
                    "quantity": 8,
                    "due_date": "2026-01-06T00:00:00",
                    "release_date": "2026-01-05T11:00:00",
                    "priority": 1,
                    "operations": [
                        {
                            "id": "RUSH-CUT",
                            "sequence": 1,
                            "name": "RUSH-CUT",
                            "duration_minutes": 45,
                            "eligible_machine_ids": ["CUT-1"],
                        },
                        {
                            "id": "RUSH-ASM",
                            "sequence": 2,
                            "name": "RUSH-ASM",
                            "duration_minutes": 60,
                            "eligible_machine_ids": ["ASM-1", "ASM-2"],
                            "dependencies": ["RUSH-CUT"],
                            "setup_family": "RED",
                        },
                    ],
                },
            },
        },
    },
}
