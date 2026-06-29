# MVP Pilot — V1.0 Sellable Roadmap

**Date:** 2026-05-06 (revised same day after scope expansion)
**Branch:** `codex/premium-ux-foundation` (continues here, no new branch needed before J0)
**Scope:** Close PlaniAdvance V2 to a sellable v1.0: an installable on-premise pilot AND a marketing video, both produced from the same milestone. Engine must be hardened first; UI premium polish builds on top.

## Problem

PlaniAdvance V2 has reached the inflection point where the engine is feature-complete, the API contracts are stable, and a complete UI exists with every page bound to a real endpoint. The premium UX foundation (`docs/superpowers/specs/2026-04-23-premium-ux-design-language.md`) delivered Phases 1-4: design tokens, component kit, AppShell + Hub + Login, and the Gantt cockpit flagship.

What remains is the gap between "all the parts work" and "a real client can install this, the engine cannot be broken by their data, and we can sell it convincingly". The user has made these convictions explicit:

1. **Engine first.** Hardening the engine after the UI is built is wasted time. The engine must be "unbreakable" before any UI premium work is done.
2. **Style is OK, polish is missing.** The current UI vision is good. The user does not want a massive design system migration on secondary pages. He wants animation, alignment, uniformization, and quality polish so the product feels premium for selling.
3. **Reports are missing.** Today PlaniAdvance has no real reporting surface. A serious APS needs production sheets, KPI dashboards, late-order reports, and per-WO traveler PDFs.
4. **Gantt is too basic.** The current Gantt cockpit is visually beautiful but lacks the advanced operations that competitor APS systems (Opcenter, Preactor, Asprova) offer: real drag-and-drop, multi-select, custom views, inline what-if.
5. **Integration vision is blocks (n8n-style).** The current Integration Studio with input/output blocks is the right direction and stays P0.

This is no longer a minimal MVP — it is a v1.0 sellable release. The "endless development" risk is real and is mitigated by milestone discipline (J0 to J7) with verifiable stop conditions.

## Direction (locked with user, 2026-05-06)

| # | Decision | Value |
|---|---|---|
| 1 | Goal | Installable on-premise pilot AND marketing video material, produced from the same milestone. |
| 2 | Pilot client | None signed. Must be credible for any small/medium manufacturer (job shop, batch, semi-flow). |
| 3 | Engine posture | Audit first (J0), then harden to a level decided after the audit. Engine must be "unbreakable" before UI premium work. |
| 4 | UI strategy | Keep current style and structure. Polish: animations, pixel-perfect alignment, uniformization toward design system, premium quality feel. NO massive page-by-page migration. |
| 5 | New modules in scope | Reports (4 deliverables: 3 PDFs + 1 in-app dashboard). Advanced Gantt (drag-n-drop, multi-select, views, inline what-if). |
| 6 | Modules priority | P0 (bulletproof): Engine, Data+Import, Scheduling, Gantt+Advanced, Scenarios, Reports, Integration Studio. P1 (presentable): Admin. P2 (exists, doesn't crash): Settings+System. |
| 7 | Deployment | Docker Compose on-premise + existing session seam (no real auth). Network access acts as the security boundary. |
| 8 | Approach | Engine hardening first, then UI premium polish + new modules in parallel where feasible. |
| 9 | Timeline | No calendar deadline. Linear chain of milestones (J0 to J7) with verifiable stop conditions. Realistic estimate: 2-4 months at solo developer pace. |

## Section 1 — Canonical user flow

The spine of the MVP. Everything must work without friction on these steps. This is also the script for the marketing video and the pilot demo.

| # | Step | Page | User action | API engaged |
|---|------|------|--------------|-------------|
| 1 | Login / Hub | `/login` -> `/` | Picks company + workspace | `auth.login`, `switchOrganization` |
| 2 | Data | `/data/work-orders` | Sees seeded WOs/machines/resources; CSV import option | `workOrders`, `machines`, `csv/import` |
| 3 | Scheduling | `/scheduling` | Runs a baseline with strategy `auto`; reads dashboard + readiness | `runSchedule`, `dashboard`, `readiness` |
| 4 | Gantt (advanced) | `/gantt` | Drag-n-drop an op, multi-select to batch-freeze, save a custom view, inline what-if preview | `gantt`, `feasibleSlots`, `previewEdits`, `applyEdits` |
| 5 | Scenarios | `/scenarios` | Compares baseline vs candidate, sees KPI/stability deltas, publishes | `compareScenarios`, `publishScenario` |
| 6 | Reports | `/reports` (new) | Generates daily production sheet (PDF), late-order report (PDF), WO traveler (PDF); reviews KPI dashboard | new endpoints + `dashboard` |
| 7 | Integration | `/integration/studio` | Builds a flow visually with n8n-style blocks, runs it, sees output | existing `flows.*` + new block UI |
| 8 | Export ERP | `/integration` (export sub-tab) | Triggers a published-plan export (full or delta) as JSON | `published-plan/export` |

### What "bulletproof" means for this flow

- Every page has a clean empty state (not infinite "Loading...")
- API transitions have explicit feedback: busy, error, empty
- Pages on the flow use the design system primitives consistently (no full redesign required, but `Button`, `Field`, `Badge`, `EmptyState`, `Flash`, `Skeleton` from the kit replace ad-hoc equivalents)
- The default `industrial` seed produces a credible demo: realistic workflow, 20+ operations, at least one late order, scenario gain visible after publish
- Animations are smooth and consistent across pages (transitions 200ms cubic-bezier per design tokens)

### Out-of-flow but in-app (P1/P2)

- Admin — functional, design system primitives applied where trivial; no full redesign
- Settings / System — functional, no polish required

## Section 2 — Milestones J0 to J7

No calendar. Each milestone has a verifiable stop condition. The MVP closes when J7 is checked.

### J0 — Engine audit + diagnostic

**Why:** the user is convinced (and right) that hardening the engine after the UI is built is wasted time. Before any UI work, we measure where the engine actually stands.

**What:**
- Run all test suites and the industrial Docker smoke; catalogue what is green/red
- Manually exercise the engine on edge cases known to be risky: empty inputs, contradictory constraints, very long WOs, very short WOs, missing materials, deadlock-prone routings, mid-run cancellation, fresh DB without seed, schedule recovery after `make stack-down`
- Code-level audit: identify risky areas in `domain/scheduling/`, `application/use_cases/`, and infrastructure (race conditions, recovery semantics, transaction boundaries, error classes)
- Produce `docs/engine-audit-2026-05.md` with findings classified as: critical / high / medium / low, plus an estimated effort to fix each
- DECISION POINT WITH USER: based on the audit, decide the level of investment for J1. Three pre-canned levels exist (see J1) but the actual choice is post-diagnosis.

**Stop:**
- All test suites pass OR red tests are documented with a fix plan in `engine-audit-2026-05.md`
- Industrial Docker smoke passes 9/9 steps
- `engine-audit-2026-05.md` exists with a categorized list of findings (target: 10-30 items)
- User has chosen the J1 hardening level explicitly

### J1 — Engine hardening (calibrated by J0)

**Why:** the engine becomes "unbreakable" so we can build UI on a stable base.

**Pre-canned levels (user chooses after J0):**
- **Level A (light):** address only critical + high findings from J0. ~1-2 weeks if J0 finds 5-10 critical/high.
- **Level B (medium):** address critical/high + add property-based tests (`hypothesis`) on top scheduling paths + stress test at 100/250/500 ops with wall-time budgets documented. ~3-4 weeks.
- **Level C (heavy):** Level B + chaos scenarios (mid-scheduling crash, race conditions on multi-tenant repositories, durability checks, migration rollback test). ~5-6 weeks.

**Stop:**
- All findings selected in the chosen level are addressed (closed in `engine-audit-2026-05.md`)
- Test suites green
- The smoke test passes deterministically 5 consecutive times on the chosen level's test set
- The user explicitly says "engine is unbreakable enough" — gate held by the user, not by the code

### J2 — Reports module (new)

**Why:** PlaniAdvance has no reporting surface today. A serious APS needs printable production sheets and an executive dashboard. This is selling material AND practical client value.

**Deliverables:**
- Backend endpoints to generate per-report payloads (production sheet, late-order report, WO traveler, dashboard data)
- PDF generator backend (likely WeasyPrint, since the project is already Python; ReportLab as fallback)
- Three printable PDFs:
  - **Production sheet** — A4 per machine for a chosen day or shift; ops with start/end times, WO refs, setup/run minutes
  - **Late-order report** — list of WOs late vs due date, by how much, engine-classified reason (material/capacity/priority/sequence), recommended action
  - **WO traveler** — one page per WO: ops sequence, machines planned, dates, materials required (printable for shop floor)
- One in-app dashboard:
  - **Executive dashboard** — KPI trends over 7/30/90 days: makespan trend, on-time ratio, average utilization, top late WOs, scenarios published count

**Stop:**
- All 3 PDFs render correctly with industrial seed data
- Each PDF can be downloaded from the new `/reports` page in the UI
- Executive dashboard loads in under 2 seconds on industrial seed
- A small README documents how to add a new report (so post-MVP additions are easy)

### J3 — Advanced Gantt

**Why:** the current Gantt is visually beautiful but operationally basic. Competitor APS Gantts (Opcenter, Preactor, Asprova, DELMIA Quintiq) offer drag-n-drop with snap, multi-select with batch operations, saved custom views, and inline what-if previews. Without these, planners cannot work at production speed.

**Pre-work:**
- Quick competitor benchmark (web research + screenshots): list features common to top APS Gantts but missing in ours. Document in `docs/gantt-benchmark-2026-05.md`. Target: 1-2 days.

**Deliverables:**
- **Drag-n-drop with snap to feasible slots** — mouse drag of a bar; on drag start, the engine is asked for `feasibleSlots`; on hover, the bar snaps to the nearest valid slot; on drop, the move goes through `previewEdits` -> visual confirmation -> `applyEdits`
- **Multi-select + batch actions** — lasso selection or ctrl+click; the inspector shows aggregate info (N ops selected); batch actions for freeze/unfreeze, change priority, mass-move
- **Custom views (saved)** — filter by WO/machine/status/priority/family/customer; group by machine vs WO vs family; save view with name; switch between views
- **Inline what-if (ghost bars)** — when an edit is being previewed, the proposed positions render as semi-transparent ghosts overlaid on current bars; user can compare visually before applying

**Stop:**
- Each of the 4 features works end-to-end on industrial seed
- Keyboard shortcuts documented in `/help` or in a Cmd+K palette
- Performance: drag operations stay smooth at 60fps on a plan with 500 ops (test with `industrial_stress` seed scaled if needed)
- Visual preview for each feature in the design preview route or in `gantt-benchmark-2026-05.md`

### J4 — UI premium polish

**Why:** the user likes the current style but wants quality polish so the product feels premium and sellable. NOT a massive page redesign.

**Scope:**
- Animations and transitions: page changes, tab switches, drawer open/close, KPI value updates, loading skeletons. All on the single token curve (cubic-bezier 0.2, 0.8, 0.2, 1) and three durations (120/200/320 ms).
- Pixel-perfect alignment audit: every page has a 4px grid check; misaligned cards/buttons/icons are fixed.
- Empty states: every page has a styled empty state with illustration or icon, primary action, and helpful text. No more raw "No data".
- Uniformization: replace remaining ad-hoc components (raw inputs, custom buttons, ad-hoc badges) with design system primitives. Goal: zero `<button>` element outside `Button`, zero `<input>` outside `Field`, zero `.pill` outside `Badge`.
- Gantt navigation polish: keyboard shortcuts (`F` fit, `[`/`]` day jump, arrow keys to navigate bars, `?` opens shortcut help). Wheel zoom. Pinch zoom on trackpad. Smooth pan.
- Cmd+K command palette (lightweight) — at least: switch page, search WO, find machine.

**Stop:**
- Animation pass complete on canonical flow pages
- Alignment audit complete on canonical flow pages (manual screenshot review)
- All canonical flow pages have styled empty states
- No raw `<button>`, `<input>`, `.pill` on canonical flow pages
- Cmd+K palette works on at least 3 commands
- User looks at the app and says "this looks premium" (subjective gate held by user)

### J5 — Integration Studio finalization (n8n vision)

**Why:** the user wants to keep the n8n-style block vision with input/output. Today the Studio exists but is mid-construction (uncommitted work on `IntegrationFlowReadinessDock`).

**Deliverables:**
- Each block visually shows its input(s) and output(s) (small ports, like n8n)
- Drag-and-connect between blocks (output of A -> input of B)
- Block library panel (left) with all available block types from `/integration/flow-blocks`
- Inspector panel (right) for selected block: edit config, see validation, see last run
- Flow run with visual progress (which block is currently running, which succeeded, which failed with error)
- Save flow + run flow buttons in toolbar
- Empty state when no flow exists ("Create your first flow") with a starter template

**Stop:**
- A user can build, save, and run a 4-block flow end-to-end (pull -> transform -> validate -> import) entirely from the visual editor
- Errors at any block are surfaced visually with the error message
- The IntegrationFlowReadinessDock work is either finished or removed — no loose ends in git

### J6 — Pilot packaging

**Why:** today's `docker compose up` is dev-oriented. For an installable pilot, we need a "lightweight production" mode and a client-oriented README.

**Stop:**
- A `docker-compose.pilot.yml` exists with: Postgres (named volume), API (built image, no live reload), UI (built static assets served by API or by a small nginx)
- `README-PILOTE.md` fits one printed page: prerequisites, install command, first login URL, where to find logs, how to back up the DB volume
- Bootstrap by default creates: one organization, one user, one workspace, the `industrial` seed
- Environment variables documented in `.env.pilot.example`
- Tested on a clean machine (or fresh VM): `docker compose -f docker-compose.pilot.yml up` followed by opening the URL produces a working app at the Login page
- Tested on at least 2 host OSes (Windows + Linux, or Windows + Mac)

### J7 — Marketing video + website captures

**Why:** the final deliverable for the website. Recorded once, factored for marketing.

**Stop:**
- An MP4 video of 5-7 minutes covers the canonical 8-step flow (now including Reports + Integration Studio) end-to-end, with voice-over or captions
- 8 to 12 high-resolution static screenshots for the website: Hub, Data, Scheduling dashboard, Gantt cockpit dark, Gantt drag-n-drop in action, Scenarios compare, Reports dashboard, a printable PDF rendering, Integration Studio with a flow, Export confirmation
- `docs/demo-script.md` allows re-recording the video later

### Dependencies

```
J0 -> J1 -> (J2 || J3 || J4 || J5) -> J6 -> J7
```

Once the engine is hardened (J1), J2/J3/J4/J5 can be worked in any order. The user is a solo developer, so "parallel" here means free choice of sequencing (interleave or finish one before starting the next), not literal parallelism. J6 (packaging) needs all four in a stable state before it can produce a clean image. J7 closes the milestone.

## Section 3 — Global stop conditions

The MVP is closed when ALL of the following are simultaneously true:

1. J0 through J7 are closed (each has its own stop criterion green)
2. The canonical 8-step flow runs without visible bugs on a freshly bootstrapped instance (`docker-compose.pilot.yml` + a single bootstrap)
3. A non-developer human (the user role-playing as "first client") can complete the canonical flow using only `README-PILOTE.md`, without asking questions
4. The marketing video is recorded and ready to publish (or already published)
5. `docs/audit-pilote.md` (produced during J0/J1 and updated through J5) lists no remaining "critical" or "high" bug on the canonical flow
6. The engine has not crashed or produced a wrong schedule during the entire J2-J7 phase

If all 6 are true, the milestone is closed. If they are not, the user finishes — without adding new scope.

## Section 4 — Out of scope (explicit)

These items exist in the code or in the user's idea space, but are explicitly NOT part of this v1.0. Documented here so the user can self-discipline during execution.

- Massive design system page migration (Admin, Settings, System keep their current style)
- Real authentication (password + JWT) — session seam is sufficient on-premise
- Multi-tenant SaaS hosting — engine supports it, but pilot is mono-instance on-premise
- Advanced metaheuristic strategies in planner UI (`sa`, `tabu`, `ga`, `lns`, `multi`) — they remain in the code but are not exposed; `auto`, `greedy`, `backward`, `cpsat` are sufficient
- Multipart CSV upload UI (the JSON CSV-string contract is sufficient)
- Responsive mobile/tablet (desktop only)
- i18n (English only for first video; French and others post-v1.0)
- Connector marketplace or non-HTTP connectors
- Automated backup/restore (the client manages their Postgres volume backup)
- Monitoring stack (Grafana, Prometheus) — `/health`, `/ready`, and Docker logs are enough for pilot
- Excel export (PDF only for J2 reports; Excel can come post-v1.0)
- Custom report builder (the 4 reports defined in J2 are the v1.0 set)

**Execution discipline:** if during J0-J7 the user has a "good idea" not already in scope, it goes to the post-MVP backlog. It does not get done in this milestone.

## Section 5 — Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| J0 reveals so many engine issues that Level C (5-6 weeks) is required | Medium-high | The audit is the audit. If Level C is needed, the user accepts the trade-off because the engine-first conviction is locked in. |
| J3 advanced Gantt drag-n-drop hits 60fps performance walls on `industrial_stress` | Medium | Performance budget is part of the stop criterion. If the wall is real, fall back to "drag-n-drop on visible window only" for v1.0. |
| J2 PDF generator (WeasyPrint) brings heavy system dependencies to the Docker image | Low | Pin the WeasyPrint version, document the system packages required in the Dockerfile, test on the target Docker base image. |
| J4 UI polish becomes endless ("just one more animation") | High | The 6 stop criteria of J4 are the contract. The "looks premium" subjective gate is held by user — once said, J4 is closed. |
| J5 Integration Studio drag-and-connect requires more frontend graph library work than expected | Medium | Use a small library (React Flow already chosen by some teams for n8n-style UIs) rather than a custom canvas. Investigate at start of J5. |
| Total elapsed time (2-4 months) creates fatigue or scope drift | High | Each milestone has a stop criterion. After each milestone closes, decide whether to continue immediately or take a planned break — but no new scope is added mid-milestone. |
| Pilot client appears mid-execution and demands deviations | Medium | Write the pilot client requirements into a "post-pilot adjustment" backlog and discuss after the pilot is installed. The pilot installs the v1.0 as defined here. |

## Section 6 — Out-of-MVP backlog (post-v1.0)

Captured here so good ideas during execution do not get lost, but are not done now:

- Migrate Admin, Settings, System pages to a more uniform polish level
- Real auth with password + JWT (probably needed for SaaS phase)
- Multi-tenant SaaS deployment story
- Multipart CSV UI uploader
- Backup/restore tooling
- i18n (start with French)
- Monitoring stack (Grafana, Prometheus)
- Excel export of reports
- Custom report builder
- Connector marketplace (non-HTTP connectors)
- Mobile/tablet companion view (read-only Gantt, alerts)
- Pilot post-mortem -> v1.1 spec
