# Pulsar — LSOS Platform Realignment Plan

**Goal:** Re-align Pulsar from “TMS-first SaaS with adjacent modules” to a true modular LSOS / Business Operating System where Transportation is one flagship app, not the product boundary.

**North star:** Pulsar should feel like a platform that contains multiple deep business applications — Operations, Finance, Assets/Fleet, Warehouse, Yard, CRM/Customers, Projects/Work Orders, Agents, Analytics, and Integrations — all unified by a shared tenant/core/agent/governance layer.

**Date:** 2026-06-16
**Branch context:** `hermes/page-standard-crud-ux`
**Reference repo:** `/root/github/personal/Pulsar-fleetbase-ops-ui`

---

## 1. Why this plan exists

Sam clarified that Pulsar must not be positioned as “just a TMS”. The TMS/logistics workflow is a major module/plus, but the product vision is broader:

> Pulsar = LSOS / business platform with large modules. Fleetbase is a useful reference because it feels like a real modular platform, not because Pulsar should copy its visuals or code.

Current docs already contain the seed of that idea, but the roadmap and UI still bias users toward “Transportation is the center, everything else supports it”. The next product move is to make the platform architecture visible in the product experience.

---

## 2. Current-state audit

### 2.1 Product docs say modular platform, but wording is still logistics-first

`PRODUCT_SPEC.md` currently says:

- “modular logistics operating platform”
- “Transportation (TMS) = first commercial module”
- modules: Fleet, Yard, Light WMS, Customer Portal, Analytics, Billing

This is close, but still frames everything under logistics. For the new vision, the first line should become closer to:

> Pulsar is a modular LSOS / business operating platform. Logistics/TMS is its first flagship vertical module, not the whole platform.

### 2.2 Roadmap has strong agent/platform work, but module strategy is still woven through TMS

`ROADMAP.md` and `docs/etat-du-projet.md` show impressive depth:

- Core platform, RBAC, module registry, audit, SSO, platform admin
- Transportation/TMS happy path
- Billing, Fleet, WMS, Yard modules
- Agents / MCP / ProposedAction / 24/7 workers
- Dispatch Workbench and operational workbench pivot

The gap is not raw capability. The gap is strategic packaging:

- Finance appears as `Billing` tied mostly to freight billing.
- Fleet appears as `Flotte` tied mostly to vehicle/trailer maintenance.
- WMS/Yard are operational modules, but still read like logistics submodules.
- Navigation is a domain rail, but it does not yet make each module feel like a full “app” with its own home, language, workflows, configuration, and agent.

### 2.3 UI shell is good technically but still feels like module switching, not a platform app launcher

`apps/web/src/routes/(app)/+layout.svelte` already has a domain rail:

- Dashboard
- Transport
- Entrepôt
- Cour
- Flotte
- Facturation
- Agents
- Réglages

This is a good base. But to feel like a platform, each domain needs:

1. A distinct module home / cockpit.
2. Module-specific navigation depth.
3. Module-specific objects and workflows.
4. Module-specific AI employee(s).
5. Cross-module links through a shared core.

Right now some modules are only one or two pages; that makes them feel like “features of Transport” rather than apps.

---

## 3. Fleetbase mechanisms to learn from

Sources inspected 2026-06-16:

- `https://fleetbase.io/platform` — “One Platform for Every Logistics Operation”; Fleet-Ops, Storefront, Ledger, Pallet, Navigator, extensions.
- `https://fleetbase.io/platform/fleetops` — Fleet-Ops = fleet management, dispatch, transport, GPS tracking, workflows.
- `https://fleetbase.io/platform/ledger` — Ledger = financial visibility, invoicing, revenue tracking, payment gateways, chart of accounts.
- `https://fleetbase.io/platform/pallet` — Pallet = WMS/inventory/pick lists/cycle counts/fulfillment.
- `https://fleetbase.io/platform/extensions` — marketplace/extensions; platform extensibility is part of the pitch.
- `https://fleetbase.io/docs/fleet-ops`, `/docs/ledger`, `/docs/pallet` — separate module docs, separate mental models.

Important: do **not** copy Fleetbase AGPL code or clone UI. Extract mechanisms:

### Mechanism A — Each module has its own brand/mental model

Fleetbase does not say “invoices inside Fleet-Ops”. It has `Ledger`. It does not say “warehouse subpage”; it has `Pallet`.

Pulsar needs the same separation:

- `Transport` / `Operations` = TMS/logistics execution
- `Finance` = accounting/billing/cash/margins, not just freight invoices
- `Assets` = fleet/equipment/maintenance/compliance, not just trucks for loads
- `Warehouse` = inventory/fulfillment module
- `Yard` = yard/dock module
- `Agents` = employee workforce layer
- `Integrations` = connectivity layer

### Mechanism B — Module homes should feel like products, not nav groups

Each module should open to a dashboard/workbench that answers:

- What is happening in this module?
- What needs attention?
- What is the next action?
- What agent is working here?
- What other modules does this connect to?

### Mechanism C — Finance should be a real app

Fleetbase Ledger is not “billing tab”. It includes invoicing, payment gateways, wallets/transactions, accounting/reporting concepts.

Pulsar Finance should eventually cover:

- AR: customer invoices, statements, payment status, overdue
- AP: supplier/carrier/vendor invoices, approvals, disputes
- Cash: expected receivables/payables, cash impact
- Margin: by client, project, load, warehouse job, asset, module
- Taxes: GST/QST/VAT once real customer invoicing starts
- Accounting integrations: QuickBooks, Xero, Sage, Acomba, etc.
- Audit agents: invoice anomaly detection, duplicate invoice, margin leak, missing PO/document

Freight billing is one vertical workflow inside Finance, not the Finance module itself.

### Mechanism D — Extensions/connectivity are part of platform credibility

Fleetbase feels like a platform partly because it has extension/developer-console ideas. Pulsar already has modules, API keys, integrations, agents, and MCP; this should be surfaced as a platform strength.

---

## 4. Target product architecture

### 4.1 Top-level platform model

```text
Pulsar LSOS
├─ Core Platform
│  ├─ Tenants / Organizations
│  ├─ Users / Roles / Permissions
│  ├─ Module registry / subscriptions
│  ├─ Documents / Files
│  ├─ Audit / Activity / Evidence
│  ├─ Notifications
│  ├─ Integrations / API / Webhooks / MCP
│  └─ Policies / Governance
│
├─ Modules / Apps
│  ├─ Operations / Transport        (TMS, dispatch, loads, routing, tracking)
│  ├─ Finance / Ledger              (AR/AP, invoices, payments, margin, audit)
│  ├─ Assets / Fleet                (vehicles, equipment, maintenance, compliance)
│  ├─ Warehouse / Inventory         (receiving, inventory, picking, fulfillment)
│  ├─ Yard / Dock                   (gate, appointments, docks, dwell)
│  ├─ CRM / Customers               (accounts, contacts, customer activity)
│  ├─ Projects / Work Orders        (future general operations beyond TMS)
│  ├─ HR / People                   (future employees, shifts, approvals)
│  └─ Analytics / Control Tower     (KPIs across modules)
│
└─ AI Workforce
   ├─ Agent roster
   ├─ Workbench / tasks / exception cases
   ├─ ProposedAction approvals
   ├─ Evidence and audit
   ├─ Policies, caps, risk tiers
   └─ Module-specific employees
```

### 4.2 Core principle

Every large module must be useful independently, but stronger when connected.

Examples:

- Finance can handle generic client/vendor invoices, but Transport can produce freight invoices into Finance.
- Assets can track equipment maintenance, but Transport can use vehicles/trailers/drivers for dispatch.
- Warehouse can manage inventory independently, but Transport can create outbound shipments.
- Agents are not a module gimmick; they are employees assigned to modules and cross-module cases.

---

## 5. Proposed module naming / packaging

### Current → Target

- `Transportation Management` → **Operations / Transport**
  - Keep TMS depth, but package as one operational app.

- `Billing` → **Finance / Ledger**
  - Billing becomes a sub-area. Add broader finance language: Receivables, Payables, Cash, Margin, Audit.

- `Fleet Management` → **Assets / Fleet**
  - Fleet becomes asset management. Vehicles are one asset type; future equipment/tools/machines should fit.

- `Light WMS` → **Warehouse / Inventory**
  - Keep WMS mechanics, but make the app feel like warehouse operations, not transport support.

- `Yard Management` → **Yard / Dock**
  - Keep visual yard plan. Add dock scheduling/dwell/detention angle.

- `Analytics` → **Control Tower / Intelligence**
  - Cross-module KPIs, executive dashboard, anomaly reports, agent performance.

- `Customer Portal` → **Client Portal / Experience**
  - External-facing client workspace, not only shipment visibility.

- `Integrations` → **Connect / Developer Platform**
  - API keys, webhooks, connectors, MCP, event streams, logs.

---

## 6. Navigation / UX target

### 6.1 Keep the two-rail shell, but make it feel like an app switcher

Current rail is already close. Improve it with:

1. **Module launcher / home screen** at `/dashboard` or `/apps`
   - Tiles for enabled modules.
   - Each tile shows module health and next work.
   - Disabled modules show “available to enable” if catalog says available.

2. **Module identity header** in each module
   - Module name, purpose, key KPIs, assigned agent.
   - Example: “Finance — money movement, invoices, margin, audit”.

3. **Module home pages that are not tables**
   - `/finance` not `/invoices` as the default.
   - `/assets` or `/fleet` as Asset Command Center.
   - `/warehouse` or `/wms` as Warehouse Control Room.

4. **Shared command palette grouped by module**
   - “Finance: create customer invoice”
   - “Assets: open maintenance work order”
   - “Transport: consolidate shipments”
   - “Agents: review proposed actions”

### 6.2 URL strategy

Preferred next evolution:

```text
/apps                      platform app launcher
/transport                 Transport module home
/transport/dispatch
/transport/orders
/transport/shipments
/transport/loads
/transport/rates

/finance                   Finance module home
/finance/receivables
/finance/payables
/finance/freight-audit
/finance/payments
/finance/margins

/assets                    Assets module home
/assets/vehicles
/assets/equipment
/assets/maintenance
/assets/compliance
/assets/assignments

/warehouse                 Warehouse module home
/warehouse/inventory
/warehouse/receiving
/warehouse/picking
/warehouse/fulfillment

/yard                      Yard module home
/yard/gate
/yard/appointments
/yard/spots

/agents                    AI workforce home
/workbench                 Could remain global or become /agents/workbench
/connect                   Integrations/developer module
/settings                  Platform admin/settings
```

Migration can keep aliases from existing paths to avoid breaking current work.

---

## 7. Finance / Ledger target depth

### 7.1 Finance module mission

> Finance turns operational work into money movement: receivables, payables, margins, payment status, tax readiness, and audit.

### 7.2 Finance sections

1. **Overview**
   - AR open
   - AP open
   - overdue invoices
   - disputed amount
   - gross margin by module/client
   - cash expected next 30 days
   - finance agent alerts

2. **Receivables**
   - customer invoices/statements
   - status: draft, approved, sent, paid, overdue
   - source: Transport, Warehouse, Projects, manual
   - taxes, due dates, payment terms

3. **Payables**
   - vendor/carrier invoices
   - approvals
   - payment status
   - duplicate detection

4. **Freight Audit**
   - keep existing autonomous freight audit
   - position it as a specialized payables audit workflow, not the whole module

5. **Margins**
   - by customer, lane, load, warehouse job, asset, project
   - leak detection: accessorial missed, fuel mismatch, rate undercharged

6. **Accounting Integrations**
   - QuickBooks / Xero / Sage / Acomba later
   - export logs, sync status, mapping errors

### 7.3 Finance agent examples

- Invoice Auditor Agent
- AR Collection Agent
- Margin Analyst Agent
- Vendor Duplicate Invoice Agent
- Tax Readiness Agent, later

---

## 8. Assets / Fleet target depth

### 8.1 Assets module mission

> Assets manages physical resources: availability, assignments, maintenance, compliance, cost, and lifecycle.

This includes fleet, but should not be limited to fleet.

### 8.2 Asset types

- Vehicle
- Trailer
- Equipment
- Tools
- Machines
- Containers
- Future: IT assets, site assets, etc.

### 8.3 Assets sections

1. **Asset Command Center**
   - available / assigned / down / maintenance
   - compliance risk
   - cost this month
   - upcoming maintenance
   - assigned agent

2. **Registry**
   - vehicles, trailers, equipment, tools
   - owner/site/customer/project assignment

3. **Maintenance**
   - work orders
   - preventive schedules
   - vendors
   - costs

4. **Compliance**
   - documents
   - inspections
   - expiry calendar

5. **Assignments**
   - assigned to load, project, site, employee, warehouse job

6. **Cost / lifecycle**
   - fuel, repair, depreciation, downtime

### 8.4 Asset agent examples

- Maintenance Planner Agent
- Compliance Watcher Agent
- Asset Utilization Analyst Agent

---

## 9. Reframing the current roadmap

### 9.1 What to preserve

Keep the strong technical substrate:

- module registry
- tenant isolation
- RBAC
- audit/evidence
- MCP/tools
- ProposedAction governance
- agents as employees
- workbench/task layer
- Dispatch Workbench
- Fleet/WMS/Yard current modules

Do not throw away current work. Repackage and deepen it.

### 9.2 What to change

Change the strategic language and next priorities:

From:

> “Pulsar Agent OS = modular logistics OS where governed Hermes agents run 24/7.”

To:

> “Pulsar LSOS = modular business operating platform where governed AI employees run across deep business apps. Transport/logistics is the first flagship vertical module.”

From:

> “Act III = modules woven around logistics.”

To:

> “Act III = platform app expansion: Finance, Assets, Warehouse, Yard, CRM, Projects, Analytics — each app ships with workflows, data model, KPIs, and agent employees.”

---

## 10. Recommended next implementation phases

### Phase P0 — Documentation and product-language correction

**Objective:** Align canonical docs so future Claude/Hermes sessions stop pulling Pulsar back into TMS-only framing.

Files:

- Modify `PRODUCT_SPEC.md`
- Modify `ROADMAP.md`
- Modify `docs/etat-du-projet.md`
- Modify `docs/module-system.md`
- Possibly add `docs/product/platform-vision.md`

Tasks:

1. Replace “modular logistics operating platform” with “modular LSOS / business operating platform”.
2. State clearly: “Transportation is the first flagship vertical module.”
3. Add target module map: Core, Transport, Finance, Assets, Warehouse, Yard, CRM, Projects, Analytics, Agents, Connect.
4. Reframe Billing → Finance/Ledger in roadmap language.
5. Reframe Fleet → Assets/Fleet in roadmap language.
6. Add a “Fleetbase mechanisms we intentionally learn from” section, with URLs and AGPL no-copy note.

Validation:

- Search docs for outdated “just logistics OS” language.
- Confirm docs preserve shipped facts and do not claim unbuilt features as built.

### Phase P1 — Platform module launcher and module homes

**Objective:** Make Pulsar visually feel like a platform of apps.

Likely files:

- `apps/web/src/routes/(app)/dashboard/+page.svelte`
- Create `apps/web/src/routes/(app)/apps/+page.svelte` or make dashboard the app launcher
- `apps/web/src/routes/(app)/+layout.svelte`
- New shared component: `apps/web/src/lib/components/platform/ModuleTile.svelte`
- New shared component: `apps/web/src/lib/components/platform/ModuleHeader.svelte`

Deliverables:

1. App launcher grid with enabled modules and health.
2. Module tiles:
   - Transport
   - Finance
   - Assets
   - Warehouse
   - Yard
   - Agents
   - Connect
3. Each tile shows next actions / alerts.
4. Domain rail labels adjusted:
   - Transport
   - Finance
   - Assets
   - Warehouse
   - Yard
   - Agents
   - Connect
   - Settings

Validation:

- Browser smoke: dashboard/app launcher makes modules feel distinct.
- `pnpm --filter @pulsar/web typecheck`
- `pnpm --filter @pulsar/web build`

### Phase P2 — Finance module home, without new schema first

**Objective:** Convert Facturation from a thin invoices page into a Finance module surface using existing billing/freight audit/customer invoice data.

Likely paths:

- Create `apps/web/src/routes/(app)/finance/+page.svelte`
- Move/alias existing `/invoices` → `/finance/receivables` or keep redirect
- Move/alias `/billing/freight-audit` → `/finance/freight-audit`
- Update `+layout.svelte` billing domain to Finance

Finance home sections:

- AR / Receivables
- AP / Payables
- Freight audit risk
- Margin leakage placeholder from current cost/rating data
- Finance agent card
- Recent finance activity

No new schema required for first pass. Use existing endpoints:

- `/billing/invoices`
- `/billing/customer-invoices`
- `/freight-audit/incoming-invoices` (actual route per controller)
- `/freight-audit/savings` if present

Then later add generic finance models.

### Phase P3 — Assets module home and asset registry posture

**Objective:** Reframe Fleet as Assets/Fleet and make it feel useful beyond TMS dispatch.

Likely paths:

- Create or refactor `apps/web/src/routes/(app)/fleet/+page.svelte`
- Consider future alias `/assets`
- Expand domain rail labels to “Assets”

First pass, no schema migration:

- Asset readiness overview
- Asset types: vehicles, trailers, drivers today; equipment/tools placeholder as future types
- Maintenance and compliance attention
- Assignments panel showing relation to loads where available
- Asset agent card

Future schema:

- General `Asset` model or gradual extension depending on architecture decision.

### Phase P4 — Platform Connect module

**Objective:** Pull integrations out of Settings and make connectivity a platform module.

Likely paths:

- Move/alias `/integrations` → `/connect`
- Add Connect module home:
  - API keys
  - webhooks
  - connectors
  - MCP/agent tools
  - event logs
  - request logs later

This gives Pulsar the “developer platform/extensions” credibility that Fleetbase surfaces.

### Phase P5 — Strategic module docs/specs for future apps

**Objective:** Prevent future module sprawl by requiring every new module to define its app identity.

Add a template doc, e.g. `docs/superpowers/templates/module-app-spec.md`, requiring:

- Module mission
- Personas
- Objects
- Workflows
- KPIs
- Agent employees
- Events/tasks/cases
- Permissions
- Cross-module links
- Module home UX
- Workbenches
- Integrations
- Seed/demo data

---

## 11. Anti-goals

- Do not turn Pulsar into a generic ERP clone immediately.
- Do not remove the TMS depth; it is the first proof module and can remain flagship.
- Do not add lots of empty modules just to look big.
- Do not make Finance/Assets only menu renames; each needs a true module home and roadmap.
- Do not copy Fleetbase UI/code. Learn the modular packaging and depth mechanisms.
- Do not bury agents in chat; agents should appear inside module workbenches as employees with actions/evidence.

---

## 12. Open architecture questions

1. Should the user-facing route be `/finance` while keeping backend module key `billing` for now?
   - Recommendation: yes, short-term. Rename backend key later only if worth migration churn.

2. Should `fleet` become `assets` in module keys?
   - Recommendation: not immediately. Change UI language first; add general asset model later.

3. Should `/dashboard` become module launcher or should `/apps` be separate?
   - Recommendation: dashboard can become hybrid: top = app launcher / module health, below = cross-module control tower.

4. How far should Finance go before first customer?
   - Recommendation: enough to feel like a module: receivables/payables/freight-audit/margin cards. Defer full GL/chart-of-accounts until real demand.

5. Should CRM/Projects/HR be declared in module catalog now?
   - Recommendation: document them in platform vision, but do not add catalog keys until a roadmap phase begins.

---

## 13. Immediate next action recommendation

Do Phase P0 + P1 next:

1. Update product docs to lock the LSOS vision.
2. Build the platform module launcher and rename/package module homes in UI.

This gives Sam the visible product shift immediately, before deeper backend module expansion.

Then P2 Finance should follow, because it is the clearest example of “not just TMS billing”.

---

## 14. Acceptance criteria for the realignment

A first-time viewer should be able to open Pulsar and say:

- “This is a platform with multiple business apps.”
- “Transport is one app, not the entire product.”
- “Finance looks like a real finance app, not a freight invoice page.”
- “Assets/Fleet looks like physical asset management, not just vehicles for dispatch.”
- “Agents are employees assigned to modules, not a chatbot feature.”
- “The system has a core platform: users, tenants, permissions, integrations, audit, modules.”

If the UI still feels like a sidebar of TMS pages, the realignment failed.
