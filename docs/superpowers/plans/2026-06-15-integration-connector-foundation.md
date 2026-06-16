# Integration Connector Foundation v1 — Implementation Plan

> **For Claude / Hermes:** this branch intentionally avoids Light WMS implementation files, Prisma schema, migrations, and global navigation. It builds a pure shared foundation that WMS, ERP, accounting, API, CSV, and webhook integrations can reuse after Claude’s WMS work lands.

**Goal:** define the browser-safe connector capability model that lets Pulsar onboard client software safely before database/API implementation.

**Architecture:** keep v1 in `@pulsar/shared` as pure TypeScript data + helpers. The API can later persist these values in JSON or normalized tables, but this slice does not choose the persistence model. Agents may read these helpers to decide whether a capability can run directly or must become a `ProposedAction`.

**Tech Stack:** TypeScript, Vitest, `@pulsar/shared` barrel export.

---

## Scope shipped in this plan

### Files added

- `packages/shared/src/integrations/connector-foundation.ts`
- `packages/shared/src/integrations/connector-foundation.spec.ts`
- `docs/superpowers/plans/2026-06-15-integration-connector-foundation.md`
- `docs/superpowers/specs/2026-06-15-client-software-connection-flow.md`

### Files modified

- `packages/shared/src/index.ts`
- `docs/superpowers/specs/2026-06-15-integration-operating-layer.md`

### Files intentionally avoided

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/*`
- `apps/api/src/modules/wms/*`
- `apps/web/src/routes/(app)/wms/*`
- `apps/web/src/routes/(app)/+layout.svelte`
- `packages/shared/src/modules.ts`

Reason: Claude is working on Light WMS. This foundation should merge without forcing him to rebase through schema/nav conflicts.

---

## TDD record

### RED

Created `connector-foundation.spec.ts` first with expectations for:

1. provider blueprints (`odoo`, `quickbooks`, `warehouse-wms`, `custom-api`, `webhook`, `csv-import`);
2. approval classification for write capabilities;
3. agent access gating;
4. onboarding readiness summary;
5. safe client-facing onboarding step order.

Initial RED command:

```bash
pnpm --filter @pulsar/shared test -- integrations/connector-foundation.spec.ts
```

Expected failure observed:

```text
Cannot find module './connector-foundation'
```

### GREEN

Implemented `connector-foundation.ts` with:

- connector provider blueprints;
- canonical capability keys;
- connection modes;
- capability risk classification;
- `requiresApprovalForCapability()`;
- `canAgentUseIntegrationCapability()`;
- `summarizeConnectorFoundation()`;
- `buildConnectorOnboardingSteps()`.

Green command:

```bash
pnpm --filter @pulsar/shared test -- integrations/connector-foundation.spec.ts
```

Expected result:

```text
25 files passed, 149 tests passed
```

---

## Product decisions

### 1. Blueprints before database

Do not begin with a connector table/migration. First define the product contract:

```text
provider → capabilities → mapping → sandbox evidence → activation → agent gate
```

This lets Claude/WMS consume the shared language without getting blocked by persistence choices.

### 2. Read-first default

ERP/accounting/WMS connectors should begin read-only:

- `customers.read`
- `orders.read`
- `invoices.read`
- `inventory.read`
- `receiving.read`
- `picking.read`

Writes exist as capability names but are gated.

### 3. Writes are not all equal

Capability risk tiers:

- `read`: safe direct read/import/receive;
- `low_write`: candidate for low-risk auto action;
- `controlled_write`: requires stronger policy;
- `sensitive_write`: human approval by default.

Current default rule: `controlled_write` and `sensitive_write` require approval unless a future policy explicitly decides otherwise. If any capability is denied direct execution because of policy, `canAgentUseIntegrationCapability()` returns `approvalRequired: true` so API/UI callers can route it to `ProposedAction` consistently, including low-risk writes while the connector is still in `propose` mode.

### 4. Agent access = intersection, not trust

An agent can use a capability only when all are true:

```text
connector enabled + health ready/live
AND connector declares the capability
AND agent is allowed that capability
AND policy allows direct execution
```

Otherwise the action is blocked or should route through `ProposedAction`.

### 5. WMS bridge

The `warehouse-wms` blueprint exists so Light WMS can later plug into the same connection language:

- `inventory.read`
- `receiving.read`
- `picking.read`
- `picking.write`

This avoids making WMS a special-case module disconnected from Integrations.

---

## Next implementation candidates

### Candidate A — API persistence

Add DB-backed tenant connection config after Claude’s WMS branch lands:

- `IntegrationConnection.capabilities Json`
- `IntegrationConnection.ownerUserId?`
- encrypted credential reference;
- sandbox evidence summary;
- activation status.

### Candidate B — `/integrations/connect` UI

Create a guided onboarding wizard:

1. choose provider;
2. authenticate;
3. select capabilities;
4. map fields;
5. sandbox test;
6. activate with monitoring.

### Candidate C — Agent tool gate

Before an agent writes to an external integration, call a shared/policy gate using the same capability model. Mutating WMS/ERP/accounting actions should create `ProposedAction` first unless policy explicitly allows direct execution.

### Candidate D — WMS integration handoff

Once Claude merges Light WMS:

- map WMS receiving/picking workflows to `receiving.*` and `picking.*` capabilities;
- document which WMS events become `DomainEvent`;
- decide which warehouse actions are internal Pulsar actions vs external connector actions.

---

## Verification commands

Run before merge:

```bash
pnpm --filter @pulsar/shared test -- integrations/connector-foundation.spec.ts integrations/operations.spec.ts
pnpm --filter @pulsar/shared build
```

Optional after UI/API touches in future branches:

```bash
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api test
```
