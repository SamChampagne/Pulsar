# Finance — Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add a `fiscalYearStartMonth` accounting setting and consume it in Budget variance (support non-calendar fiscal years). No new entity/API/route — enriches the existing billing config framework. Default 1 = current behavior (no regression).

**Architecture:** Pure `fiscalYearBounds(fiscalYear, startMonth)` in `@pulsar/shared`; `fiscalYearStartMonth` added to the billing `MODULE_SETTINGS_CATALOG` (auto-surfaced on `/billing/config`); `BudgetsService.variance` uses `fiscalYearBounds` with the tenant's setting instead of a hardcoded Jan–Dec window.

**Tech Stack:** NestJS, Prisma (read-only here), `@pulsar/shared`, Vitest, Jest+supertest.

## Global Constraints
- Tenant isolation (rule 1). Setting via the existing `/modules/billing/settings` gating (rule 5/36).
- Config catalog default MUST equal current behavior: `fiscalYearStartMonth` default `1` → fiscalYearBounds == the current Jan–Dec window (zero regression).
- Pure helper in `@pulsar/shared` (no Node imports). NO GL write, NO migration. Rebuild shared after changing it.
- Money/dates: UTC; end-of-day on the upper bound.

---

### Task 1: Shared — fiscalYearBounds helper + billing config setting

**Files:** Create `packages/shared/src/billing/fiscal.ts` + `fiscal.spec.ts`; modify `index.ts`; modify `packages/shared/src/config/module-settings.ts`.

- [ ] **Step 1: Failing test**
```ts
// packages/shared/src/billing/fiscal.spec.ts
import { describe, it, expect } from 'vitest';
import { fiscalYearBounds } from './fiscal';
describe('fiscalYearBounds', () => {
  it('startMonth=1 → Jan 1 .. Dec 31 end-of-day (same as calendar)', () => {
    const { from, to } = fiscalYearBounds(2026, 1);
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
  it('startMonth=4 (April) → Apr 1 fy .. Mar 31 fy+1 end-of-day', () => {
    const { from, to } = fiscalYearBounds(2026, 4);
    expect(from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-03-31T23:59:59.999Z');
  });
  it('clamps out-of-range startMonth to 1', () => {
    expect(fiscalYearBounds(2026, 0).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(fiscalYearBounds(2026, 13).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
```
- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- fiscal`.
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/billing/fiscal.ts
/** UTC bounds of fiscal year `fiscalYear` starting at month `startMonth` (1–12).
 * startMonth=1 → [fy-01-01 00:00:00.000, fy-12-31 23:59:59.999].
 * Pure: no Date.now / argless new Date. */
export function fiscalYearBounds(fiscalYear: number, startMonth: number): { from: Date; to: Date } {
  const m = Number.isFinite(startMonth) && startMonth >= 1 && startMonth <= 12 ? Math.floor(startMonth) : 1;
  const from = new Date(Date.UTC(fiscalYear, m - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(fiscalYear + 1, m - 1, 1, 0, 0, 0, 0));
  to.setUTCMilliseconds(to.getUTCMilliseconds() - 1); // one year minus 1ms → last instant of the FY
  return { from, to };
}
```
- [ ] **Step 4: Re-export** `export * from './billing/fiscal';` in `index.ts`.
- [ ] **Step 5: Config setting** — in `packages/shared/src/config/module-settings.ts`, in the `billing` settings array, add:
```ts
      { key: 'fiscalYearStartMonth', label: 'Mois de début d\'exercice fiscal', help: '1=janvier (défaut). Ex: 4=exercice avril→mars. Utilisé par les écarts de budget.', type: 'number', default: 1, min: 1, max: 12 },
```
- [ ] **Step 6: GREEN + build** — test + `pnpm --filter @pulsar/shared build`.
- [ ] **Step 7: Commit** `feat(shared): fiscalYearBounds helper + billing fiscalYearStartMonth setting`

---

### Task 2: API — Budget variance consumes fiscalYearStartMonth

**Files:** Modify `apps/api/src/modules/billing/budgets/budgets.service.ts`.

- [ ] **Step 1:** Inject `ModuleSettingsService` into `BudgetsService` (already provided in the billing module / via ModuleRegistryModule — confirm it's importable like the other billing services do). Import `fiscalYearBounds` from `@pulsar/shared`.
- [ ] **Step 2:** In `variance`, replace the hardcoded Jan–Dec window:
```ts
const s = await this.moduleSettings.resolve(tenantId, 'billing');
const startMonth = Number(s.fiscalYearStartMonth) || 1;
const { from, to } = fiscalYearBounds(budget.fiscalYear, startMonth);
```
and use `from`/`to` in the `journalLine.findMany` `entry: { date: { gte: from, lte: to } }` filter (replacing the previous `Date.UTC(fy,0,1)`/`Date.UTC(fy,11,31,...)`).
- [ ] **Step 3:** Verify `pnpm --filter @pulsar/api typecheck` (0) + `pnpm --filter @pulsar/api build` (0). With default `fiscalYearStartMonth=1`, the window is identical to before → existing budget e2e stays green.
- [ ] **Step 4: Commit** `feat(api): budget variance respects fiscalYearStartMonth`

---

### Task 3: API — e2e proving fiscalYearStartMonth shifts the budget window

**Files:** Modify `apps/api/test/budgets.e2e-spec.ts` (add a case) OR create `apps/api/test/account-settings.e2e-spec.ts`. Prefer adding to the existing budgets suite to reuse its bootstrap.

- [ ] **Step 1:** Add a case: with a budget for fiscalYear=Y and a budgeted account that has a GL charge dated **January Y**:
  - With `fiscalYearStartMonth=1` (default) → variance `actual` includes the January charge.
  - PUT `/modules/billing/settings` `{ settings: { fiscalYearStartMonth: 4 } }` (April start) → re-fetch `GET /billing/budgets/:id/variance` → the January-Y charge now falls in fiscal year Y-1 (Apr Y-1..Mar Y), so it is EXCLUDED from FY=Y's window → `actual` drops by that charge.
  - Reset the setting back to 1 in afterAll (or use a dedicated tenant) so other suites aren't affected.
  - Use delta-safe assertions (snapshot the GL via Prisma for the specific account/date, like the existing budget e2e does) — assert the actual CHANGES by the January charge amount between the two settings.
- [ ] **Step 2:** `pnpm --filter @pulsar/api test:e2e -- budgets` (or `account-settings`) all pass. **Commit** `test(api): budget variance honours fiscalYearStartMonth`

---

### Task 4: Final verification + docs
- [ ] **Step 1:** `pnpm typecheck` (0), `pnpm test` (shared incl fiscal.spec).
- [ ] **Step 2:** `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Default fiscalYearStartMonth=1 → no regression. Confirm pre-existing flakes (wms-fulfillment fixed; phase12-workbench/osrm) in isolation. IMPORTANT: ensure any suite that changed `fiscalYearStartMonth` reset it (or used a dedicated tenant) so it doesn't bleed into other suites.
- [ ] **Step 3:** Docs: CLAUDE.md "Hard rules (continued)" entry **49** for Account Settings (accounting settings live in the billing config framework — rule 36; `fiscalYearStartMonth` default 1 is consumed by Budget variance via pure `fiscalYearBounds`; default 1 = calendar year = current behavior; no new entity/API/migration). `docs/etat-du-projet.md` note. Accurate claims only.
- [ ] **Step 4:** Commit fixups + docs.

---
## Self-Review notes (author)
- Coverage: helper+config (T1), Budget consumption (T2), e2e proving the shift (T3), verify+docs (T4). No new entity/migration/route — honest enrichment of the existing config framework.
- Zero-regression guarantee: default `fiscalYearStartMonth=1` makes `fiscalYearBounds(fy,1)` == the previous Jan–Dec window exactly. The e2e must reset the setting to avoid cross-suite bleed.
- Type consistency: `fiscalYearBounds` (T1) consumed in T2.
