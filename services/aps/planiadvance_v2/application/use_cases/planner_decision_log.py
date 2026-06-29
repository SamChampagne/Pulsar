"""Versioned planner-decision log stored with schedule diagnostics."""

from __future__ import annotations

import hashlib
import json

from .planner_actions import PlannerActionApplication


def build_planner_decision_log(
    applications: list[PlannerActionApplication],
) -> dict[str, object]:
    records = [
        _record(index=index, application=application)
        for index, application in enumerate(applications, start=1)
    ]
    return {
        "version": "planner-decisions-v1",
        "record_count": len(records),
        "applied_count": sum(1 for item in records if item["status"] == "applied"),
        "ignored_count": sum(1 for item in records if item["status"] == "ignored"),
        "records": records,
    }


def _record(
    *,
    index: int,
    application: PlannerActionApplication,
) -> dict[str, object]:
    payload = {
        "sequence": index,
        "action": application.action.as_dict(),
        "status": application.status,
        "message": application.message,
        "target_ids": list(application.target_ids),
        "impact": dict(application.impact),
    }
    return {
        "decision_id": _decision_id(payload),
        "decision_version": 1,
        **payload,
    }


def _decision_id(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
