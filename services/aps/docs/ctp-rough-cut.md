# Rough-Cut CTP

`POST /scheduling/ctp` simulates a candidate work order without persisting a
schedule. The endpoint is meant for early customer promise checks, ERP order
entry, and future UI flows where a planner needs a quick answer before running a
full finite schedule.

## When To Use It

Use CTP when a new order, rush order, or sales inquiry needs an answer like:

- Can we promise the requested due date?
- What is the earliest rough-cut completion date?
- Which requested dates can receive the full quantity?
- Does the rough-cut answer need finite validation before the shop floor trusts it?
- Which machine/day becomes the capacity hotspot after inserting the candidate?

## Request Shape

The default mode is intentionally fast:

```json
{
  "horizon_start": "2026-01-05T00:00:00",
  "horizon_days": 5,
  "strategy": "infinite",
  "finite_validation": false,
  "promise_dates": ["2026-01-05T12:00:00", "2026-01-06T17:00:00"],
  "candidate_order": {
    "id": "WO-CTP-001",
    "name": "Customer promise",
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
        "eligible_machine_ids": ["CUT-1"]
      }
    ]
  }
}
```

## Rough-Cut Vs Finite Validation

`strategy: "infinite"` ignores finite machine contention, but still respects
release dates, calendars, maintenance, routings, dependencies, transfer times,
and material availability. This gives a fast theoretical promise date.

If rough-cut assignments overlap on the same machine, the endpoint returns
`recommendation: "finite_validation_required"`. In that case, call it again with:

```json
{
  "strategy": "infinite",
  "finite_validation": true,
  "finite_strategy": "greedy"
}
```

The response then includes `finite_validation` with its own completion date,
promise delta, metrics, and recommendation.

## Response Fields To Read First

- `recommendation`: `promise`, `negotiate_date`, `finite_validation_required`, or `not_feasible`.
- `earliest_completion`: first completion date found for the candidate.
- `promise_delta_minutes`: minutes late versus due date; negative or zero means on time.
- `available_quantity_by_date`: all-or-none quantity answer for due date and requested promise dates.
- `rough_cut_capacity`: machine/day capacity picture after insertion.
- `planner_explanation`: human-readable risk, reason, capacity hotspot, and next action.
- `insertion_impact`: delta versus baseline rough-cut schedule.

## Detailed Insertion Impact

`insertion_impact` compares the baseline run without the candidate against the
run with the candidate inserted. It is still non-persistent, but it gives the
planner a concrete blast radius before saying yes to a customer.

It includes:

- candidate assignment windows and machine load
- machine load deltas
- impacted machine ids
- existing operations moved, delayed, accelerated, or moved to another machine
- per-work-order movement summaries
- total and max existing-operation delay

When `finite_validation=true`, the `finite_validation` block also returns its
own `insertion_impact`. That finite impact is the one to trust for shop-floor
commitment because it includes real machine contention.

## Quantity Semantics

`available_quantity_by_date` currently uses `mode: "all_or_none"`. That means
the full candidate quantity is available only when the whole candidate order can
complete by the requested date. Partial quantity promises should be added later
when split lots and partial shipment semantics are modelled end-to-end.

## Planner Interpretation

Typical flow:

1. Call CTP with `strategy: "infinite"`.
2. If `recommendation` is `promise`, the date is good under rough-cut assumptions.
3. If `recommendation` is `finite_validation_required`, call again with finite validation.
4. If `recommendation` is `negotiate_date`, use `earliest_completion`, `promise_delta_minutes`, and `planner_explanation.recommended_action`.
5. If `recommendation` is `not_feasible`, review routings, calendars, materials, or extend the horizon.

This endpoint should stay non-persistent. Once the planner accepts a promise or a
what-if scenario, use `/scheduling/run` or a future scenario workflow to persist
the official plan.
