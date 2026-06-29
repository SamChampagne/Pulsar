# J0 — Engine Audit + Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a categorized, evidence-backed audit of the PlaniAdvance V2 engine (domain + application + relevant infrastructure/API surfaces) so Sam can decide the J1 hardening level (A-light, B-medium, C-heavy) with full information.

**Architecture:** Discovery-driven, not TDD. Each task either runs an existing suite, probes a risky scenario, or reads a code area, and then writes its findings into the structured audit document `docs/engine-audit-2026-05.md`. Fixes happen in J1 — J0 only documents.

**Tech Stack:** Python 3.11+, pytest, FastAPI, SQLAlchemy 2.0, Postgres (Docker), make / PowerShell on Windows.

**Deliverable:** `docs/engine-audit-2026-05.md` with these sections — Methodology, Test Suite Baseline, Edge Case Findings, Code Audit Findings, Categorized Findings Table, J1 Level Recommendation.

**Out of scope:** any code fix. If a probe reveals a bug, document it; do not fix during J0.

---

## File structure

| Path | Purpose | Action |
|------|---------|--------|
| `docs/engine-audit-2026-05.md` | The deliverable audit document with all findings | Create |
| `scripts/audit/` | Throwaway Python probes used during edge-case discovery | Create temporary |
| `scripts/audit/probe_*.py` | Individual probe scripts (one per edge case) | Create |

The probe scripts are **not** committed long-term. They are working scratch files that produce evidence captured into the audit doc. After the audit is committed, they can be deleted (or kept under `scripts/audit/` if useful for J1).

---

## Phase A — Test suite baseline (Tasks 1-5)

The objective is to know exactly what is green and what is red **before** probing anything new.

### Task 1: Create the audit document skeleton

**Files:**
- Create: `docs/engine-audit-2026-05.md`

- [ ] **Step 1: Create the file with the structured skeleton**

Write the following content to `docs/engine-audit-2026-05.md`:

```markdown
# Engine Audit — 2026-05

**Date:** 2026-05-06
**Scope:** PlaniAdvance V2 engine (domain/scheduling, application/use_cases, infrastructure/db, api/routes for scheduling+integration)
**Goal:** Categorized findings to drive the J1 hardening level decision (A / B / C).
**Methodology:** test suite run + edge case probes + code reading. No fixes applied during J0; all fixes deferred to J1.

---

## 1. Methodology

- Step A: run every existing test suite, capture pass/fail counts and any failure details
- Step B: probe 8 known-risky edge cases through one-off Python scripts under `scripts/audit/probe_*.py`
- Step C: read 5 critical code areas (strategy registry, run_scheduling use case, db repositories session lifecycle, api dependencies, in-flight uncommitted integration changes) and note risks
- Step D: classify findings as critical / high / medium / low with effort estimates, then recommend J1 level

---

## 2. Test Suite Baseline

(filled in by Tasks 2-5)

### 2.1 Unit tests (`tests/unit/`)

- Run command:
- Result:
- Failures:

### 2.2 Integration tests (`tests/integration/`)

- Run command:
- Result:
- Failures:

### 2.3 Real-stack Postgres test (`tests/integration/test_real_stack_postgres.py`)

- Run command:
- Result:
- Failures:

### 2.4 Industrial Docker smoke (`docs/industrial-docker-smoke.md`)

- Run command:
- Result:
- Steps passed / failed:

---

## 3. Edge Case Findings

(filled in by Tasks 6-13, one subsection per probe)

---

## 4. Code Audit Findings

(filled in by Tasks 14-18, one subsection per code area)

---

## 5. Categorized Findings Table

(filled in by Task 19)

| ID | Finding | Severity | Effort | Source task |
|----|---------|----------|--------|-------------|

---

## 6. J1 Level Recommendation

(filled in by Task 20)
```

- [ ] **Step 2: Verify the file exists and is readable**

Run: `Get-Content docs/engine-audit-2026-05.md | Measure-Object -Line`
Expected: shows ~50+ lines (the skeleton is loaded)

- [ ] **Step 3: Commit the skeleton**

```powershell
git add docs/engine-audit-2026-05.md
git commit -m "Add engine audit skeleton for J0"
```

---

### Task 2: Run the unit test suite and document results

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 2.1)

- [ ] **Step 1: Verify the dev install is current**

Run: `python -m pip install -e ".[dev]"`
Expected: "Successfully installed planiadvance-v2-..." or "Requirement already satisfied"

- [ ] **Step 2: Run unit tests with verbose summary**

Run: `python -m pytest tests/unit/ -v --tb=short 2>&1 | Tee-Object -FilePath audit-unit.log`
Expected: completes in under 60 seconds; produces `audit-unit.log`

- [ ] **Step 3: Extract pass/fail counts**

Run: `Select-String -Path audit-unit.log -Pattern "passed|failed|error" | Select-Object -Last 5`
Note the final summary line, e.g., `=========== 187 passed in 12.34s ===========` or `=== 5 failed, 182 passed ===`

- [ ] **Step 4: Document results in section 2.1 of the audit**

Replace the section 2.1 content in `docs/engine-audit-2026-05.md` with:

```markdown
### 2.1 Unit tests (`tests/unit/`)

- Run command: `python -m pytest tests/unit/ -v --tb=short`
- Result: <N> passed, <M> failed, <K> errored, <T>s wall time
- Failures:
  - `tests/unit/<path>::test_name` — one-line failure description (capture full trace under section 4 if root cause is engine code)
  - (or: "no failures")
```

- [ ] **Step 5: Delete the temporary log**

Run: `Remove-Item audit-unit.log`

---

### Task 3: Run the integration test suite and document results

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 2.2)

- [ ] **Step 1: Ensure Postgres is running (required for some integration tests)**

Run: `docker compose -f docker/docker-compose.yml up -d postgres`
Expected: "Container ... Started" or "Container ... Running"

- [ ] **Step 2: Run integration tests**

Run: `python -m pytest tests/integration/ -v --tb=short -m "not real_stack" 2>&1 | Tee-Object -FilePath audit-integration.log`
Expected: completes; some tests may require Postgres; if pytest does not have a `real_stack` marker, just run `python -m pytest tests/integration/ -v --tb=short --ignore=tests/integration/test_real_stack_postgres.py`

- [ ] **Step 3: Extract pass/fail counts**

Run: `Select-String -Path audit-integration.log -Pattern "passed|failed|error" | Select-Object -Last 5`

- [ ] **Step 4: Document results in section 2.2**

Same template as section 2.1, applied to integration results.

- [ ] **Step 5: Delete the temporary log**

Run: `Remove-Item audit-integration.log`

---

### Task 4: Run the real-stack Postgres test and document results

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 2.3)

- [ ] **Step 1: Confirm DATABASE_URL is set or fall back to default Docker compose URL**

Run: `Write-Output "DATABASE_URL=$env:DATABASE_URL"`
If empty, run: `$env:DATABASE_URL = "postgresql+psycopg://planiadvance:planiadvance@localhost:5432/planiadvance"`

- [ ] **Step 2: Apply migrations if not done**

Run: `python -m alembic upgrade head`
Expected: "INFO ... Running upgrade ..." or "Already at head"

- [ ] **Step 3: Run real-stack test**

Run: `python -m pytest tests/integration/test_real_stack_postgres.py -v --tb=short 2>&1 | Tee-Object -FilePath audit-realstack.log`
Expected: completes; passes if Postgres + migrations are aligned

- [ ] **Step 4: Document results in section 2.3**

Same template as section 2.1.

- [ ] **Step 5: Delete the temporary log**

Run: `Remove-Item audit-realstack.log`

---

### Task 5: Run the industrial Docker smoke and document results

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 2.4)
- Reference: `docs/industrial-docker-smoke.md`

- [ ] **Step 1: Read the smoke procedure**

Run: `Get-Content docs/industrial-docker-smoke.md`
Expected: a step-by-step procedure with docker compose commands

- [ ] **Step 2: Tear down any current stack**

Run: `docker compose -f docker/docker-compose.yml down`

- [ ] **Step 3: Bring up the stack with the industrial seed**

Run:
```powershell
$env:SEED_DATASET="industrial"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml up --build -d postgres
docker compose -f docker/docker-compose.yml run --rm --build migrate
docker compose -f docker/docker-compose.yml run --rm --build seed
docker compose -f docker/docker-compose.yml up --build -d api
```
Expected: each step exits with code 0; the API is reachable on port 8000

- [ ] **Step 4: Run the smoke**

Run: `docker compose -f docker/docker-compose.yml run --rm --build smoke 2>&1 | Tee-Object -FilePath audit-smoke.log`
Expected: smoke runs the 9 step sequence (auth -> run -> readiness -> dashboard -> gantt -> feasible-slots -> preview -> apply -> compare -> publish); records each step

- [ ] **Step 5: Document results in section 2.4**

Replace section 2.4 with:

```markdown
### 2.4 Industrial Docker smoke (`docs/industrial-docker-smoke.md`)

- Run command: `docker compose -f docker/docker-compose.yml run --rm --build smoke`
- Result: <X>/9 steps passed, total wall time <T>s
- Steps passed: auth, run, readiness, dashboard, gantt, feasible-slots, preview, apply, compare, publish (mark each)
- Failed steps: (list step name + error excerpt; OR "none")
```

- [ ] **Step 6: Tear down**

Run: `docker compose -f docker/docker-compose.yml down`

- [ ] **Step 7: Delete the temporary log**

Run: `Remove-Item audit-smoke.log`

- [ ] **Step 8: Commit the test baseline section**

```powershell
git add docs/engine-audit-2026-05.md
git commit -m "Audit J0: test suite baseline captured"
```

---

## Phase B — Edge case probes (Tasks 6-13)

For each probe: write a small Python script under `scripts/audit/probe_<n>_<name>.py` that exercises the engine via the in-memory CLI/use-case path (no DB needed for most). Run it. Capture the outcome (crash / silent wrong result / clean error / success) into a section 3.x entry.

Use this template for each probe script header:

```python
"""Edge case probe: <description>

Expected: <what we hope/think happens>
Actual: <captured by running this>
"""
from datetime import datetime, timedelta
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryWorkOrderRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryInventoryRepository,
    InMemorySupplyRepository,
    InMemoryCalendarRepository,
)
from planiadvance_v2.application.use_cases.run_scheduling import RunScheduling
# ... add what's needed per probe
```

If `InMemory*Repository` class names differ in the actual codebase, the engineer must adapt — verify with `Get-ChildItem planiadvance_v2/infrastructure/in_memory/`.

### Task 6: Probe — empty inputs (complete reference probe)

**Files:**
- Create: `scripts/audit/probe_01_empty_inputs.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.1)

This probe is the **complete working reference**. Probes 02-08 follow the same pattern — adapt entity construction and the targeted scenario, keep the same outer structure (`make_use_case`, `try/except`, print outcome).

- [ ] **Step 1: Write the probe script**

Create `scripts/audit/probe_01_empty_inputs.py` with the following exact content:

```python
"""Edge case probe 01: empty inputs.

Three scenarios:
  A. Schedule with zero work orders.
  B. Schedule with WOs but zero operations.
  C. Schedule with WOs+operations but zero machines.

The repository constructors and the RunScheduling signature were verified
against planiadvance_v2/infrastructure/in_memory/repositories.py and
planiadvance_v2/application/use_cases/run_scheduling.py on 2026-05-06.
"""
from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority, Shift
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)


HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)  # Monday


def make_calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def make_use_case(
    *,
    work_orders: list[WorkOrder] | None = None,
    machines: list[Machine] | None = None,
    calendars: list[WorkingCalendar] | None = None,
) -> RunScheduling:
    wo_repo = InMemoryWorkOrderRepository()
    for wo in work_orders or []:
        wo_repo.add(wo)
    machine_repo = InMemoryMachineRepository()
    for m in machines or []:
        machine_repo.add(m)
    cal_repo = InMemoryCalendarRepository()
    for c in calendars or []:
        cal_repo.add(c)
    return RunScheduling(
        work_orders=wo_repo,
        machines=machine_repo,
        calendars=cal_repo,
        resources=InMemoryResourceRepository(),
        inventory=InMemoryInventoryRepository(),
        supplies=InMemorySupplyRepository(),
        schedules=InMemoryScheduleRepository(),
    )


def run_and_report(label: str, uc: RunScheduling) -> None:
    print(f"=== {label} ===")
    try:
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                horizon_days=14,
                strategy="greedy",
                persist=False,
            )
        )
        print(
            f"  RESULT: assignments={len(result.schedule.assignments)}, "
            f"solver_status={result.solver_status}, "
            f"objective_value={result.objective_value}"
        )
    except Exception as exc:  # noqa: BLE001 — this is intentional; we are probing
        print(f"  EXCEPTION: {type(exc).__name__}: {exc}")


def scenario_a_no_work_orders() -> None:
    uc = make_use_case(calendars=[make_calendar()], machines=[
        Machine(id="M1", name="Machine 1", calendar_id="CAL"),
    ])
    run_and_report("Scenario A: zero work orders", uc)


def scenario_b_no_operations() -> None:
    cal = make_calendar()
    wo = WorkOrder(
        id="WO-1",
        name="Empty WO",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario B: WO with zero operations", uc)


def scenario_c_no_machines() -> None:
    cal = make_calendar()
    op = Operation(
        id="OP-1",
        work_order_id="WO-1",
        sequence=1,
        name="OP-1",
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=10),
        eligible_machine_ids=["M1"],
        dependencies=[],
    )
    wo = WorkOrder(
        id="WO-1",
        name="WO-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(work_orders=[wo], machines=[], calendars=[cal])
    run_and_report("Scenario C: ops reference machine but no machines exist", uc)


if __name__ == "__main__":
    scenario_a_no_work_orders()
    scenario_b_no_operations()
    scenario_c_no_machines()
```

- [ ] **Step 2: Verify the probe runs (the `add` method on in-memory repos may differ — adapt if needed)**

Run: `python -c "from planiadvance_v2.infrastructure.in_memory.repositories import InMemoryWorkOrderRepository; r = InMemoryWorkOrderRepository(); print([m for m in dir(r) if not m.startswith('_')])"`
Expected: a list of public methods. If `add` is not present, the actual method is likely `save`, `create`, or `upsert`. Adapt the probe and continue.

- [ ] **Step 3: Run the probe**

Run: `python scripts/audit/probe_01_empty_inputs.py 2>&1 | Tee-Object -FilePath probe-01.log`

- [ ] **Step 4: Document outcome in section 3.1**

Replace/add section 3.1 in `docs/engine-audit-2026-05.md`:

```markdown
### 3.1 Empty inputs

- Probe: `scripts/audit/probe_01_empty_inputs.py`
- Scenarios:
  - A (zero WOs): <crashed / clean error / empty schedule returned> — details
  - B (WOs no operations): <outcome>
  - C (WOs+ops no machines): <outcome>
- Verdict: <safe / minor issue / risk> — explain
- Suggested fix area (for J1): <e.g., RunScheduling._validate_inputs guard>
```

- [ ] **Step 5: Delete the log**

Run: `Remove-Item probe-01.log`

---

### Task 7: Probe — contradictory constraints

**Files:**
- Create: `scripts/audit/probe_02_contradictory_constraints.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.2)

- [ ] **Step 1: Write the probe**

Create `scripts/audit/probe_02_contradictory_constraints.py`:

```python
"""Edge case probe 02: contradictory constraints

Three scenarios:
  A. Operation requires capability X, no machine has X
  B. Operation lists eligible_machine_ids = [non-existent ID]
  C. Operation has both eligible_machine_ids AND a routing pointing to a different machine
"""
# Adapt the pattern from probe_01: build minimal entities, call RunScheduling, capture outcome
```

The engineer fills in scenarios using the same pattern.

- [ ] **Step 2: Run and document in section 3.2**

Same pattern as Task 6 (run, capture, write findings, delete log).

---

### Task 8: Probe — extreme durations

**Files:**
- Create: `scripts/audit/probe_03_extreme_durations.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.3)

- [ ] **Step 1: Write the probe**

Create `scripts/audit/probe_03_extreme_durations.py`:

```python
"""Edge case probe 03: extreme durations

Three scenarios:
  A. Operation with duration_minutes = 0
  B. Operation with duration_minutes > 24*60 (longer than any working day)
  C. Operation with setup_minutes >> duration_minutes
"""
```

- [ ] **Step 2: Run and document in section 3.3**

Same pattern.

---

### Task 9: Probe — missing materials

**Files:**
- Create: `scripts/audit/probe_04_missing_materials.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.4)

- [ ] **Step 1: Write the probe**

Create `scripts/audit/probe_04_missing_materials.py`:

```python
"""Edge case probe 04: missing materials

Two scenarios:
  A. Operation requires material M, M has 0 inventory and 0 supply lots
  B. Operation requires material M, supply arrives AFTER the operation's release_date
"""
```

Reference `tests/unit/scheduling/test_material_feasibility.py` for the entity construction patterns.

- [ ] **Step 2: Run and document in section 3.4**

Same pattern.

---

### Task 10: Probe — circular dependencies

**Files:**
- Create: `scripts/audit/probe_05_circular_deps.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.5)

- [ ] **Step 1: Write the probe**

Create `scripts/audit/probe_05_circular_deps.py`:

```python
"""Edge case probe 05: circular dependencies

Two scenarios:
  A. Op A.dependencies = [B], Op B.dependencies = [A] — direct cycle
  B. Op A -> B -> C -> A — three-step cycle
"""
```

Reference `tests/unit/scheduling/test_dependency_links.py` for the entity construction.

- [ ] **Step 2: Run and document in section 3.5**

Same pattern.

---

### Task 11: Probe — fresh DB API behavior

**Files:**
- Create: `scripts/audit/probe_06_fresh_db_api.py` (this one uses `httpx` against a running API)
- Modify: `docs/engine-audit-2026-05.md` (section 3.6)

- [ ] **Step 1: Tear down and bring up the stack with NO seed**

Run:
```powershell
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up --build -d postgres
docker compose -f docker/docker-compose.yml run --rm --build migrate
docker compose -f docker/docker-compose.yml up --build -d api
# do NOT run the seed step
Start-Sleep -Seconds 3
```

- [ ] **Step 2: Probe the API endpoints**

Create `scripts/audit/probe_06_fresh_db_api.py`:

```python
"""Edge case probe 06: fresh DB without seed — API behavior

Calls each of the canonical-flow endpoints and records the HTTP status + body.
Goal: a fresh client should never see HTTP 500. Acceptable: 404 with structured body, 422 with validation error, etc.
"""
import httpx

BASE = "http://localhost:8000"
HEADERS = {"X-Organization-Id": "missing", "X-User-Id": "missing"}

def hit(method, path, **kwargs):
    try:
        resp = httpx.request(method, f"{BASE}{path}", timeout=10, **kwargs)
        print(f"  {method} {path} -> {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:
        print(f"  {method} {path} -> EXCEPTION: {type(exc).__name__}: {exc}")

if __name__ == "__main__":
    hit("GET", "/health")
    hit("GET", "/ready")
    hit("GET", "/auth/me", headers=HEADERS)
    hit("GET", "/scheduling/runs", headers=HEADERS)
    hit("POST", "/scheduling/run", json={"horizon_days": 14}, headers=HEADERS)
    hit("GET", "/scheduling/runs/sched-not-real/dashboard", headers=HEADERS)
    hit("GET", "/scheduling/runs/sched-not-real/gantt", headers=HEADERS)
    hit("GET", "/work-orders", headers=HEADERS)
    hit("GET", "/machines", headers=HEADERS)
```

- [ ] **Step 3: Run the probe**

Run: `python scripts/audit/probe_06_fresh_db_api.py 2>&1 | Tee-Object -FilePath probe-06.log`

- [ ] **Step 4: Document outcomes in section 3.6**

Pay attention to: any HTTP 500 (= bug), any silent 200 with wrong/empty body (= UX trap), authentication errors when expected.

- [ ] **Step 5: Tear down and delete log**

Run: `docker compose -f docker/docker-compose.yml down; Remove-Item probe-06.log`

---

### Task 12: Probe — schedule recovery after stack reset

**Files:**
- Create: `scripts/audit/probe_07_recovery.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.7)

- [ ] **Step 1: Bring up + seed + create one schedule**

Run:
```powershell
$env:SEED_DATASET="industrial"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml up --build -d postgres
docker compose -f docker/docker-compose.yml run --rm --build migrate
docker compose -f docker/docker-compose.yml run --rm --build seed
docker compose -f docker/docker-compose.yml up --build -d api
Start-Sleep -Seconds 3
```

- [ ] **Step 2: Create a probe that records, then simulates a UI client across a reset**

Create `scripts/audit/probe_07_recovery.py`:

```python
"""Edge case probe 07: schedule recovery after stack reset

Steps:
  1. login + create a baseline schedule
  2. capture the schedule_id
  3. (manual) tear down + reseed via PowerShell between calls
  4. attempt to fetch the captured schedule_id and observe behavior
  5. attempt to list schedules and confirm reconciliation guidance is clear
"""
# The engineer runs this in two parts, with a manual stack reset in between
```

- [ ] **Step 3: Document section 3.7 with whether the API returns clean 404s, what the journal shows, etc.**

- [ ] **Step 4: Tear down**

Run: `docker compose -f docker/docker-compose.yml down`

---

### Task 13: Probe — strategy availability gaps

**Files:**
- Create: `scripts/audit/probe_08_strategy_gaps.py`
- Modify: `docs/engine-audit-2026-05.md` (section 3.8)

- [ ] **Step 1: Write the probe**

Create `scripts/audit/probe_08_strategy_gaps.py`:

```python
"""Edge case probe 08: strategy availability gaps

Two scenarios:
  A. Request strategy='cpsat' on a system where ortools is NOT installed (uninstall, request, re-install)
  B. Request strategy='nonexistent_name' — does the engine return a clear error or a 500?
  C. Request strategy='infinite' (rough cut) on a dataset with material constraints — does it correctly mark them ignored?
"""
from planiadvance_v2.domain.scheduling.strategy import resolve_strategy
# Adapt to the registry contract
```

- [ ] **Step 2: Run and document section 3.8**

Same pattern.

- [ ] **Step 3: Commit the edge case probe section**

```powershell
git add docs/engine-audit-2026-05.md scripts/audit/
git commit -m "Audit J0: edge case probes 1-8 documented"
```

---

## Phase C — Code-level audit (Tasks 14-18)

For each area: read the listed files, look for the listed risks, write findings into the audit doc.

### Task 14: Code audit — strategy registry and lazy loading

**Files:**
- Read: `planiadvance_v2/domain/scheduling/strategy.py`
- Read: `planiadvance_v2/domain/scheduling/scheduler.py` (legacy entrypoint)
- Read: `planiadvance_v2/domain/scheduling/__init__.py`
- Modify: `docs/engine-audit-2026-05.md` (section 4.1)

- [ ] **Step 1: Read the strategy registry**

Run: `Get-Content planiadvance_v2/domain/scheduling/strategy.py`

Look for:
- How strategies register themselves
- Whether the registry is thread-safe (matters if FastAPI processes parallel requests)
- Whether `resolve_strategy(name)` raises a clear error on unknown names
- Whether `StrategyProfile` and `SchedulerStrategy` contracts are enforced (typed Protocol or duck typing)

- [ ] **Step 2: Read the legacy scheduler**

Run: `Get-Content planiadvance_v2/domain/scheduling/scheduler.py`

Look for:
- Is it still imported anywhere? (`Grep` for `from planiadvance_v2.domain.scheduling.scheduler`)
- Does it overlap with the strategy registry? Risk: drift between two paths

- [ ] **Step 3: Document findings in section 4.1**

```markdown
### 4.1 Strategy registry and lazy loading

**Files reviewed:** `domain/scheduling/strategy.py`, `domain/scheduling/scheduler.py`, `domain/scheduling/__init__.py`

**Findings:**
- F-1: <short title> — <severity hint> — <one paragraph evidence with file:line where useful>
- F-2: ...

**Risks:**
- (list)

**Suggested fix area for J1:**
- (list)
```

---

### Task 15: Code audit — RunScheduling use case

**Files:**
- Read: `planiadvance_v2/application/use_cases/run_scheduling.py`
- Read: `planiadvance_v2/application/use_cases/run_scheduling_from_snapshot.py`
- Modify: `docs/engine-audit-2026-05.md` (section 4.2)

- [ ] **Step 1: Read the use case**

Run: `Get-Content planiadvance_v2/application/use_cases/run_scheduling.py`

Look for:
- Input validation at entry (or absence of)
- Error classes raised — are they consistent with the rest of the application layer?
- Transaction boundary — is each call atomic? what happens on partial failure?
- Diagnostics population — is the decision_layer always populated?
- Side effects — does it write to repositories before returning?

- [ ] **Step 2: Compare with run_from_snapshot**

Run: `Get-Content planiadvance_v2/application/use_cases/run_scheduling_from_snapshot.py`

Look for: code duplication between the two paths, drift in diagnostics, different validation rules.

- [ ] **Step 3: Document findings in section 4.2**

Same template as section 4.1.

---

### Task 16: Code audit — DB repository session lifecycle

**Files:**
- Read: `planiadvance_v2/infrastructure/db/session.py`
- Read: `planiadvance_v2/infrastructure/db/repositories/` (key ones: schedules, work_orders, machines)
- Modify: `docs/engine-audit-2026-05.md` (section 4.3)

- [ ] **Step 1: Read the session factory**

Run: `Get-Content planiadvance_v2/infrastructure/db/session.py`

Look for:
- Session scope (per request? long-lived?)
- Transaction commit semantics (auto-commit, explicit commit, rollback on exception)
- Connection pool tuning (size, overflow, timeout)
- Exception swallowing

- [ ] **Step 2: Read 2-3 critical repositories**

Run:
```powershell
Get-ChildItem planiadvance_v2/infrastructure/db/repositories/ -Filter *.py | Select-Object Name
```

Pick the 3 most important (scheduling-related: schedules, work_orders, machines).

For each, look for:
- Whether queries use eager loading appropriately (N+1 risks)
- Whether write methods commit/flush explicitly
- Idempotency on insert (do duplicate inserts raise IntegrityError that surfaces cleanly?)

- [ ] **Step 3: Document findings in section 4.3**

Same template.

---

### Task 17: Code audit — API dependencies and security

**Files:**
- Read: `planiadvance_v2/api/dependencies.py` (CURRENTLY UNCOMMITTED CHANGES)
- Read: `planiadvance_v2/api/security.py` (CURRENTLY UNCOMMITTED CHANGES)
- Read: `planiadvance_v2/api/error_handlers.py`
- Modify: `docs/engine-audit-2026-05.md` (section 4.4)

- [ ] **Step 1: Show the uncommitted diff first**

Run: `git diff planiadvance_v2/api/dependencies.py planiadvance_v2/api/security.py`

This reveals what the in-flight integration work changed.

- [ ] **Step 2: Read the current state of each file**

Run:
```powershell
Get-Content planiadvance_v2/api/dependencies.py
Get-Content planiadvance_v2/api/security.py
Get-Content planiadvance_v2/api/error_handlers.py
```

Look for:
- Whether each `get_<use_case>` factory builds repositories from a per-request session (correct) or shares state across requests (race risk)
- Whether security guards are enforced consistently (no bypass paths)
- Whether `DomainError` -> HTTP mapping covers all custom error classes the use cases raise

- [ ] **Step 3: Document findings in section 4.4**

Note explicitly which findings are caused by the uncommitted in-flight work vs the baseline code. The audit should help Sam decide whether to commit, revert, or amend that work as part of J1 cleanup.

---

### Task 18: Code audit — uncommitted integration changes (in-flight work)

**Files:**
- Read: `planiadvance_v2/api/routes/integration.py` (UNCOMMITTED CHANGES)
- Read: `planiadvance_v2/api/schemas.py` (UNCOMMITTED CHANGES)
- Read: `planiadvance_v2/application/use_cases/__init__.py` (UNCOMMITTED CHANGES)
- Read: `planiadvance_v2/application/use_cases/integration_flows.py` (UNCOMMITTED CHANGES)
- Read: `tests/unit/api/test_integration_http.py` (UNCOMMITTED CHANGES)
- Read: `ui/src/components/IntegrationFlowReadinessDock.tsx` (NEW UNCOMMITTED FILE)
- Modify: `docs/engine-audit-2026-05.md` (section 4.5)

- [ ] **Step 1: Show the diff for all of them**

Run: `git diff -- planiadvance_v2/api/routes/integration.py planiadvance_v2/api/schemas.py planiadvance_v2/application/use_cases/__init__.py planiadvance_v2/application/use_cases/integration_flows.py tests/unit/api/test_integration_http.py`

- [ ] **Step 2: Read the new file**

Run: `Get-Content ui/src/components/IntegrationFlowReadinessDock.tsx`

- [ ] **Step 3: Run the affected tests**

Run: `python -m pytest tests/unit/api/test_integration_http.py -v --tb=short 2>&1 | Tee-Object -FilePath audit-integration-http.log`

If anything red here, that's a J0 finding. The decision (commit / amend / revert) is a J1 input.

- [ ] **Step 4: Document findings in section 4.5**

Explicitly answer:
- Is this work in a shippable state?
- If not, what is needed to either ship it or revert it cleanly?
- Severity for J1: what is the cost of carrying this uncommitted vs landing it?

- [ ] **Step 5: Delete log**

Run: `Remove-Item audit-integration-http.log`

- [ ] **Step 6: Commit code-audit section**

```powershell
git add docs/engine-audit-2026-05.md
git commit -m "Audit J0: code-level findings sections 4.1-4.5"
```

---

## Phase D — Synthesis and J1 decision (Tasks 19-22)

### Task 19: Categorize all findings into the central table

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 5)

- [ ] **Step 1: Re-read sections 2, 3, 4 and harvest findings**

Run: `Get-Content docs/engine-audit-2026-05.md`

For each finding (test failure, edge case issue, code-audit risk):
- Assign an ID (`F-001`, `F-002`, ...)
- Assign severity:
  - **critical** — engine produces wrong schedules, crashes, or loses data
  - **high** — visible to a planner, blocks the canonical flow
  - **medium** — degraded UX or risky pattern, not blocking
  - **low** — noise or future-proofing
- Estimate effort in `XS` (<1h), `S` (1-4h), `M` (1-2 days), `L` (3-5 days), `XL` (>1 week)

- [ ] **Step 2: Fill section 5 table**

Replace the placeholder table in section 5 with the full categorized table:

```markdown
## 5. Categorized Findings Table

| ID | Finding | Severity | Effort | Source task |
|----|---------|----------|--------|-------------|
| F-001 | <short title> | critical | M | Task 6 (probe 01) |
| F-002 | ... | high | S | Task 14 (audit 4.1) |
| ... | ... | ... | ... | ... |

**Totals:** N critical, M high, K medium, L low. Total effort estimate: <XS+S+M+L+XL summary>.
```

---

### Task 20: Recommend a J1 level with rationale

**Files:**
- Modify: `docs/engine-audit-2026-05.md` (section 6)

- [ ] **Step 1: Compute totals**

From section 5: count by severity. Sum effort estimates per level mapping:
- Level A (light): only critical + high → estimated effort sum
- Level B (medium): A + medium → estimated effort sum + 2-3 days for hypothesis property tests
- Level C (heavy): B + low + chaos scenarios → estimated effort sum + 1-2 weeks chaos work

- [ ] **Step 2: Write section 6**

Replace section 6 placeholder with:

```markdown
## 6. J1 Level Recommendation

### Summary

- **Findings:** <N> critical, <M> high, <K> medium, <L> low
- **Notable risks (top 3):**
  1. F-XXX — <one line>
  2. F-XXX — <one line>
  3. F-XXX — <one line>

### Effort by level

| Level | Includes | Effort estimate (solo dev) |
|-------|----------|---------------------------|
| A (light) | All critical + high | ~<X> days |
| B (medium) | A + medium + property-based tests on top scheduling paths | ~<Y> days |
| C (heavy) | B + chaos scenarios + multi-tenant race testing + migration rollback | ~<Z> days |

### Recommendation

**Recommended level:** <A / B / C>

**Rationale:** (2-3 sentences explaining why this level matches Sam's "engine first, unbreakable" posture given what was found)

**Caveats:** (1-2 sentences on what is intentionally excluded from the recommended level)

### Decision (filled by Sam after reading this)

- [ ] Sam reviewed
- [ ] Sam selected level: ___
- [ ] J1 plan can now be drafted using this level
```

- [ ] **Step 3: Commit the synthesis**

```powershell
git add docs/engine-audit-2026-05.md
git commit -m "Audit J0: categorized findings and J1 level recommendation"
```

---

### Task 21: Optional cleanup of probe scripts

**Files:**
- Delete or move: `scripts/audit/probe_*.py`

- [ ] **Step 1: Decide to keep or delete**

If the probes are useful as reproducers for J1, keep them under `scripts/audit/`. Add a short `scripts/audit/README.md` describing what each one tests.

If they are throwaway, delete:

Run: `Remove-Item -Recurse scripts/audit/`

- [ ] **Step 2: Commit the choice**

```powershell
git add scripts/audit/  # if kept
# OR
git add -u scripts/audit/  # if deleted
git commit -m "Audit J0: clean up probe scripts"
```

---

### Task 22: Surface to Sam for J1 level decision

**Files:** none (interactive step)

- [ ] **Step 1: Open the audit doc**

Run: `Invoke-Item docs/engine-audit-2026-05.md`

- [ ] **Step 2: Sam reviews section 6 and selects A / B / C**

Mark the chosen level explicitly in the audit doc's section 6 "Decision" subsection.

- [ ] **Step 3: Commit Sam's decision**

```powershell
git add docs/engine-audit-2026-05.md
git commit -m "Audit J0: Sam selected J1 hardening level <X>"
```

- [ ] **Step 4: Trigger writing-plans for J1**

Once the level is chosen, Sam (or the assistant) invokes the writing-plans skill again with the audit doc as input to draft the J1 plan calibrated to the chosen level.

---

## Stop Criteria for J0

J0 is closed when ALL of the following are true:

1. `docs/engine-audit-2026-05.md` exists and is committed
2. Sections 2.1, 2.2, 2.3, 2.4 are filled with actual test/smoke results (not placeholders)
3. Sections 3.1 to 3.8 are filled with actual probe outcomes
4. Sections 4.1 to 4.5 are filled with actual code-audit findings
5. Section 5 has a categorized table with at least 10 findings (target: 10-30)
6. Section 6 has a J1 level recommendation AND Sam's selected level
7. Test suites status is captured (green or red with documentation)

If steps 1-7 are checked, J0 is done. Move to J1 plan drafting.
