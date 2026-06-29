"""Edge case probe 07: schedule recovery after stack reset.

Simulates a UI client that has a stale schedule_id after a stack reset.
Steps:
  1. Create a baseline schedule on the seeded DB, capture its schedule_id.
  2. Tear down + reseed the stack (wipes the schedule from DB).
  3. Try to fetch the stale schedule_id — expect clean 404, not 500.

Run manually with a live stack. The docker management is done outside this
script; this script only hits the API endpoints.

Usage:
  1. Bring up seeded stack (see probe instructions).
  2. python scripts/audit/probe_07_recovery.py --phase create
     (outputs: SCHEDULE_ID=<id>)
  3. Tear down + reseed stack.
  4. python scripts/audit/probe_07_recovery.py --phase fetch --id <id>
     (outputs: HTTP status + body for the stale id)
"""
import argparse

import httpx

BASE = "http://localhost:8000"
HEADERS = {"X-Organization-Id": "org-demo", "X-User-Id": "user-1"}


def create_baseline() -> None:
    print("=== Phase: Create baseline schedule ===")
    r = httpx.post(
        f"{BASE}/scheduling/run",
        json={"horizon_days": 14, "strategy": "greedy"},
        headers=HEADERS,
        timeout=30,
    )
    print(f"  POST /scheduling/run -> {r.status_code}")
    if r.status_code == 200:
        schedule_id = r.json()["schedule_id"]
        print(f"  SCHEDULE_ID={schedule_id}")
    else:
        print(f"  FAILED: {r.text[:300]}")


def fetch_stale(schedule_id: str) -> None:
    print(f"=== Phase: Fetch stale schedule_id={schedule_id} after stack reset ===")
    for path in [
        f"/scheduling/runs/{schedule_id}/dashboard",
        f"/scheduling/runs/{schedule_id}/gantt",
    ]:
        r = httpx.get(f"{BASE}{path}", headers=HEADERS, timeout=10)
        body = r.text[:300].replace("\n", " ")
        print(f"  GET {path} -> {r.status_code}: {body}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["create", "fetch"], default="create")
    parser.add_argument("--id", default="")
    args = parser.parse_args()

    if args.phase == "create":
        create_baseline()
    else:
        fetch_stale(args.id)
