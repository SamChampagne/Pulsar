# Finance — Actifs / Immobilisations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Fixed-asset register + straight-line depreciation that posts `Dr Depreciation Expense / Cr Accumulated Depreciation` to the GL (transactional, idempotent per asset+period). Disposal is status-only v1 (no GL).

**Architecture:** `FixedAsset` + `DepreciationEntry` in the billing module; pure schedule + transition helpers in `@pulsar/shared`; depreciation posts via `LedgerService.postTx` inside the entry-creation transaction. New `billing.assets.read|manage` permissions. NO acquisition/disposal GL (register holds cost; GL holds depreciation only — self-consistent).

**Tech Stack:** NestJS, Prisma, SvelteKit Svelte-5, `@pulsar/shared`, Vitest, Jest+supertest.

## Global Constraints
- Tenant isolation (rule 1); `@RequireModule(MODULE_KEYS.BILLING)` + `billing.assets.read|manage` (rule 5).
- Status changes ONLY via `canTransitionFixedAsset` + conditional `updateMany` claim (rule 2, TOCTOU).
- Enum mirror shared↔Prisma (rule 3); rebuild shared+database after (rule 7).
- Audit transitions + depreciate (rule 6); FK/accountCodes validated (rule 9).
- Depreciation GL: balanced (`isBalanced`), idempotent `sourceType='depreciation'`, posted via `LedgerService.postTx` inside the depreciate transaction so a GL failure rolls back the DepreciationEntry (rule 41). NO acquisition/disposal GL in v1.
- `accumulatedDepreciation` never exceeds `cost − salvageValue`.
- Money `Decimal(12,2)`, Number at boundary, round2.
- Web: align local types to REAL API DTO + grep stale field names; valid Tone union; verify `pnpm --filter @pulsar/web typecheck`.

---

### Task 1: Shared — asset enums + schedule helpers + state machine + chart accounts

**Files:** Create `packages/shared/src/billing/assets.ts` + `assets.spec.ts`; modify `ledger.ts` (DEFAULT_CHART); modify `index.ts`.

- [ ] **Step 1: Failing test**
```ts
// packages/shared/src/billing/assets.spec.ts
import { describe, it, expect } from 'vitest';
import { buildDepreciationSchedule, depreciationForNextPeriod, canTransitionFixedAsset, FixedAssetStatus } from './assets';
describe('buildDepreciationSchedule', () => {
  it('straight-line sums to cost − salvage; last period absorbs rounding; bookValue tracks', () => {
    const s = buildDepreciationSchedule({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12 });
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ period: 1, amount: 100, accumulated: 100, bookValue: 1100 });
    expect(s[11].bookValue).toBe(0);
    expect(Math.round(s.reduce((a, r) => a + r.amount, 0) * 100) / 100).toBe(1200);
  });
  it('absorbs rounding on the last period', () => {
    const s = buildDepreciationSchedule({ cost: 100, salvageValue: 0, usefulLifeMonths: 3 }); // 33.33×2 + 33.34
    expect(Math.round(s.reduce((a, r) => a + r.amount, 0) * 100) / 100).toBe(100);
    expect(s[2].bookValue).toBe(0);
  });
});
describe('depreciationForNextPeriod', () => {
  it('caps so accumulated never exceeds cost − salvage', () => {
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 0 })).toBe(100);
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 1150 })).toBe(50);
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 1200 })).toBe(0);
  });
});
describe('canTransitionFixedAsset', () => {
  it('DRAFT→ACTIVE/DISPOSED, ACTIVE→DISPOSED, DISPOSED terminal', () => {
    expect(canTransitionFixedAsset(FixedAssetStatus.DRAFT, FixedAssetStatus.ACTIVE)).toBe(true);
    expect(canTransitionFixedAsset(FixedAssetStatus.ACTIVE, FixedAssetStatus.DISPOSED)).toBe(true);
    expect(canTransitionFixedAsset(FixedAssetStatus.DISPOSED, FixedAssetStatus.ACTIVE)).toBe(false);
    expect(canTransitionFixedAsset(FixedAssetStatus.ACTIVE, FixedAssetStatus.DRAFT)).toBe(false);
  });
});
```
- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- assets`.
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/billing/assets.ts
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export enum DepreciationMethod { STRAIGHT_LINE = 'STRAIGHT_LINE' }
export enum FixedAssetStatus { DRAFT = 'DRAFT', ACTIVE = 'ACTIVE', DISPOSED = 'DISPOSED' }
export const FIXED_ASSET_TRANSITIONS: Record<FixedAssetStatus, FixedAssetStatus[]> = {
  [FixedAssetStatus.DRAFT]: [FixedAssetStatus.ACTIVE, FixedAssetStatus.DISPOSED],
  [FixedAssetStatus.ACTIVE]: [FixedAssetStatus.DISPOSED],
  [FixedAssetStatus.DISPOSED]: [],
};
export function canTransitionFixedAsset(from: FixedAssetStatus, to: FixedAssetStatus): boolean {
  return FIXED_ASSET_TRANSITIONS[from]?.includes(to) ?? false;
}
export interface DepreciationScheduleRow { period: number; amount: number; accumulated: number; bookValue: number }
export function buildDepreciationSchedule(input: { cost: number; salvageValue: number; usefulLifeMonths: number }): DepreciationScheduleRow[] {
  const { cost, salvageValue, usefulLifeMonths } = input;
  const depreciable = round2(cost - salvageValue);
  const life = Math.max(1, Math.floor(usefulLifeMonths));
  const monthly = round2(depreciable / life);
  const rows: DepreciationScheduleRow[] = [];
  let accumulated = 0;
  for (let p = 1; p <= life; p++) {
    const amount = p < life ? monthly : round2(depreciable - accumulated); // last absorbs rounding
    accumulated = round2(accumulated + amount);
    rows.push({ period: p, amount, accumulated, bookValue: round2(cost - accumulated) });
  }
  return rows;
}
export function depreciationForNextPeriod(input: { cost: number; salvageValue: number; usefulLifeMonths: number; accumulated: number }): number {
  const depreciable = round2(input.cost - input.salvageValue);
  const remaining = round2(depreciable - input.accumulated);
  if (remaining <= 0) return 0;
  const life = Math.max(1, Math.floor(input.usefulLifeMonths));
  const monthly = round2(depreciable / life);
  return round2(Math.min(monthly, remaining));
}
```
- [ ] **Step 4: DEFAULT_CHART** — in `ledger.ts`, append: `{ code: '1500', name: 'Immobilisations', type: AccountType.ASSET }`, `{ code: '1590', name: 'Amortissement cumulé', type: AccountType.ASSET }`, `{ code: '5100', name: 'Dotation aux amortissements', type: AccountType.EXPENSE }`.
- [ ] **Step 5: Re-export** `export * from './billing/assets';` in `index.ts`.
- [ ] **Step 6: GREEN + build.** **Step 7: Commit** `feat(shared): fixed-asset depreciation helpers + state machine + chart accounts`

---

### Task 2: Shared — billing.assets permissions

**Files:** `permissions.ts`.
- [ ] Add `ASSETS_READ: 'billing.assets.read'`, `ASSETS_MANAGE: 'billing.assets.manage'` to the BILLING block AND `billing(...)` catalog entries ('View fixed assets' / 'Manage fixed assets + depreciation'). Build shared. Commit `feat(shared): billing.assets.read|manage permissions`.

---

### Task 3: Database — FixedAsset + DepreciationEntry

**Files:** `schema.prisma` + migration.
- [ ] Add `enum DepreciationMethod { STRAIGHT_LINE }` + `enum FixedAssetStatus { DRAFT ACTIVE DISPOSED }` (mirror shared, multi-line). Add `FixedAsset` + `DepreciationEntry` models verbatim from spec (Decimals, cascade entry→asset, `@@unique([tenantId,assetCode])`, `DepreciationEntry @@unique([tenantId,assetId,period])`, indexes, `@@map`). Add `fixedAssets FixedAsset[]` to `Tenant`. `pnpm db:up`; `pnpm db:migrate -- --name finance_assets` (additive); `pnpm --filter @pulsar/database build`. Commit `feat(db): FixedAsset/DepreciationEntry`. Touch only schema + migration.

---

### Task 4: API — FixedAssetsService + controller + seed chart

**Files:** Create `apps/api/src/modules/billing/assets/fixed-assets.service.ts`, `fixed-assets.controller.ts`, `dto/fixed-asset.dto.ts`; modify `billing.module.ts`; ensure chart seed includes the new accounts (the DEFAULT_CHART seed loop already does; run reseed in T7).

- [ ] **Step 1: DTO** — `CreateFixedAssetDto { @IsString @Length(1,40) assetCode; @IsString @Length(1,120) name; @IsOptional @IsString category?; @IsDateString acquisitionDate; @IsNumber @Min(0) cost; @IsOptional @IsNumber @Min(0) salvageValue?; @IsInt @Min(1) @Max(1200) usefulLifeMonths; @IsOptional @IsString @Matches(/^[0-9A-Z]{1,10}$/) depreciationExpenseAccountCode?; @IsOptional @IsString @Matches(/^[0-9A-Z]{1,10}$/) accumulatedDepreciationAccountCode? }`; `UpdateFixedAssetDto extends PartialType`; `DepreciateDto { @IsDateString period }`.
- [ ] **Step 2: Service** (inject PrismaService, AuditLogsService, LedgerService):
  - CRUD tenant-scoped (update/remove guard findFirst{id,tenantId}; DELETE only DRAFT else 400). Defaults salvageValue 0, account codes '5100'/'1590'.
  - `schedule(tenantId, id)` → load asset (404) → `buildDepreciationSchedule({cost,salvageValue,usefulLifeMonths})` (Number-coerce Decimals).
  - `activate(tenantId, userId, id)`: claim `updateMany {id,tenantId,status:DRAFT}→{status:ACTIVE}` guarded by `canTransitionFixedAsset(DRAFT,ACTIVE)`; count===0 → 400; audit.
  - `dispose(tenantId, userId, id)`: load (must allow DISPOSED from current via canTransition); claim `updateMany {id,tenantId,status:current}→{status:DISPOSED, disposedAt:now}` (only if canTransitionFixedAsset(current,DISPOSED)); count===0 → 409; audit. NO GL.
  - `depreciate(tenantId, userId, id, periodIso)`: load asset (404); must be ACTIVE (else 400). `amount = depreciationForNextPeriod({cost,salvageValue,usefulLifeMonths,accumulated: Number(accumulatedDepreciation)})`; if `amount<=0` → 400 'fully depreciated'. `period = startOfMonth(new Date(periodIso))` (UTC first of month). In a `$transaction`:
    - create `DepreciationEntry {tenantId, assetId, period, amount}` — wrap to catch Prisma P2002 (unique tenant,asset,period) → throw ConflictException('period already depreciated').
    - `updateMany FixedAsset {id,tenantId} data:{ accumulatedDepreciation: new Prisma.Decimal(round2(accumulated+amount)) }`.
    - `ledger.postTx(tx, tenantId, { date: period, memo: \`Depreciation \${asset.assetCode} \${periodIso}\`, sourceType:'depreciation', sourceId: entry.id, lines:[{accountCode: asset.depreciationExpenseAccountCode, debit: amount},{accountCode: asset.accumulatedDepreciationAccountCode, credit: amount}] }, userId)`.
    - audit (entityType 'fixed-asset', action UPDATE).
  - Return the updated asset.
- [ ] **Step 3: Controller** — `@Controller('billing/fixed-assets')`, `@RequireModule(MODULE_KEYS.BILLING)`; `GET` list/:id/:id-schedule → `ASSETS_READ`; `POST`/`PATCH`/`DELETE`/`:id/activate`/`:id/depreciate`/`:id/dispose` → `ASSETS_MANAGE`. Declare `:id/schedule` before `:id`.
- [ ] **Step 4: Wire BillingModule.** Verify typecheck + build (0). **Commit** `feat(api): fixed assets + straight-line depreciation (GL)`

---

### Task 5: API — assets e2e

**Files:** Create `apps/api/test/assets.e2e-spec.ts`. Mirror billing-ledger/payments e2e bootstrap; grant `billing.assets.read|manage`.
- [ ] Cover: create asset (cost 1200, salvage 0, life 12); `GET :id/schedule` → 12 rows × 100, last bookValue 0; activate → ACTIVE; depreciate period (e.g. this-year-01) → DepreciationEntry created, balanced GL `sourceType='depreciation'` Dr 5100 100 / Cr 1590 100, asset.accumulatedDepreciation 100; re-depreciate same period → 409; dispose → DISPOSED; tenant isolation 404. Concrete assertions; unique assetCode (`Date.now()`).
- [ ] `pnpm --filter @pulsar/api test:e2e -- assets` all pass. **Commit** `test(api): fixed assets depreciation e2e`

---

### Task 6: Web — fixed assets page + nav

**Files:** Create `apps/web/src/routes/(app)/billing/fixed-assets/+page.svelte`; modify `navigation.ts`.
- [ ] List (assetCode, name, cost, accumulatedDepreciation, net book value = cost−accumulated, status badge); create/edit modal (assetCode, name, category, acquisitionDate, cost, salvageValue, usefulLifeMonths, account codes); detail with schedule preview (`GET :id/schedule`); actions by status: DRAFT→activate; ACTIVE→depreciate (period date input)+dispose; reload after. Align local types to the REAL API shapes (asset fields + schedule rows {period,amount,accumulated,bookValue}) + grep. Number-coerce Decimals. Valid tones (DRAFT neutral, ACTIVE ok, DISPOSED warn/neutral).
- [ ] Nav `{ href: '/billing/fixed-assets', label: 'Immobilisations', perm: PERMISSIONS.BILLING.ASSETS_READ }` after "Budgets".
- [ ] `pnpm --filter @pulsar/web typecheck` 0 errors. **Commit** `feat(web): fixed assets page + schedule + nav`

---

### Task 7: Final verification + docs
- [ ] `pnpm typecheck` (0), `pnpm test` (shared incl assets.spec).
- [ ] `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Additive; the only GL impact is new depreciation entries under new accounts → NO regression to existing suites expected. Confirm any pre-existing flake in isolation. (Reseed picks up the new chart accounts 1500/1590/5100.)
- [ ] Docs: CLAUDE.md "Hard rules (continued)" entry **47** for Assets (fixed-asset register; straight-line depreciation posts Dr 5100/Cr 1590 transactionally + idempotent `sourceType='depreciation'`; NO acquisition/disposal GL v1 — register holds cost; status via `canTransitionFixedAsset`; `billing.assets.read|manage`). Keep claims ACCURATE. `docs/etat-du-projet.md` note.
- [ ] Commit fixups + docs.

---
## Self-Review notes (author)
- Coverage: helpers+chart+enum+SM (T1), perms (T2), models (T3), service+depreciate-GL (T4), e2e (T5), web (T6), verify+docs (T7).
- Risk surface: the depreciate `$transaction` (entry create + accumulated increment + `postTx`, all-or-nothing; P2002 idempotence on (tenant,asset,period); cap via depreciationForNextPeriod). Disposal is deliberately status-only (no GL) — documented v1 simplification.
- Type consistency: `buildDepreciationSchedule`/`depreciationForNextPeriod`/`canTransitionFixedAsset` (T1) consumed in T4; `LedgerService.postTx` (from Payments sub-project) reused in T4.
