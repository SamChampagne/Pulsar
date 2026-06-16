# Pulsar LSOS — Phase 2 Module Depth Implementation Plan

**Branch:** `hermes/lsos-module-depth-phase2`  
**Stacked on:** `hermes/lsos-platform-realignment` / PR #29  
**Goal:** Move Pulsar from “module names in a navbar” to a platform where each module has its own product surface, operating model, agent lane, and cross-module connections.

## Product direction

Pulsar should feel like a true LSOS platform:

- **Platform launcher** shows major apps/domains, not just routes.
- **Each module home** communicates a mission, KPIs, workflows, risks, and agents.
- **Transport is one flagship app**, not the architectural center of all other modules.
- **Finance / Ledger** owns money movement across the company.
- **Assets / Fleet** owns physical resources across the company.
- **Connect** owns integrations, APIs, webhooks, MCP, and external system readiness.
- **AI Workforce** operates across every domain through ProposedActions, evidence, policies, and audit.

## Phase 2 scope

### 1. Assets / Fleet module home

Implemented in this phase:

- New route: `/assets`
- Navigation domain `Assets` now lands on `/assets` instead of `/fleet`.
- `/fleet` remains the deeper roster/maintenance page.
- `/assets` uses real API-backed seed data:
  - `/fleet/overview`
  - `/transportation/vehicles`
  - `/transportation/trailers`
  - `/transportation/drivers`

UX intent:

- Show Assets as a company-wide physical resource system, not only a TMS fleet page.
- Include readiness, maintenance, compliance, blockers, assignment graph, and future equipment/lifecycle-cost lanes.
- Introduce an “Assets operator agent” lane for governed actions.

### 2. Launcher / nav adjustment

Implemented:

- `/apps` Assets tile now opens `/assets`.
- App shell Assets domain home is `/assets`.
- Context nav contains:
  - Assets home
  - Fleet roster
  - Maintenance & compliance

### 3. Next module depth candidates

Continue in this order:

1. **Finance / Ledger depth**
   - add clear AR/AP/Freight Audit/Cash/Margin lanes;
   - use existing invoice/freight-audit endpoints;
   - make Finance feel independent from TMS while still consuming transport data.
2. **Transport / Operations home**
   - add `/transport` as the domain home instead of landing directly in `/dispatch`;
   - show execution, planning, exceptions, tendering, tracking, POD, and agent lanes.
3. **Connect / Developer Platform depth**
   - split connector readiness, API keys, webhooks, MCP tools, event logs;
   - make it feel like Fleetbase Extensions/Developer Platform mechanism.
4. **Platform launcher polish**
   - add module layers: Core, Business Apps, AI Workforce, Connect;
   - show tenant enabled/disabled state and cross-module dependencies.

## Design principles

- Each module must answer:
  - What job does this module own?
  - What are its core objects?
  - What are the active risks/exceptions?
  - What does the assigned agent do?
  - What cross-module data does it produce/consume?
- Prefer real API data and honest empty states over fake-filled dashboards.
- If seed data is thin, say so in the UI with roadmap cards instead of pretending.
- Keep old deep routes working while adding new module-home surfaces.

## Verification checklist

Before PR:

- `PATH=/root/.hermes/node/bin:$PATH pnpm typecheck`
- `PATH=/root/.hermes/node/bin:$PATH pnpm build`
- Browser smoke:
  - `/apps`
  - `/assets`
  - `/fleet`
  - `/finance`
  - `/connect`

## PR strategy

This is a stacked branch on top of PR #29. If PR #29 merges first:

1. Retarget this PR to `main`.
2. Merge/rebase `origin/main` if needed.
3. Verify `mergeable: MERGEABLE`.
4. Re-run checks.
