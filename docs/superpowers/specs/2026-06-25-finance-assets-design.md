# Finance — Sous-projet #6 : Actifs / Immobilisations — Design

Date : 2026-06-25 · Module `billing`. Inspiration ERPNext : Asset, catégorie, calendrier d'amortissement, écritures d'amortissement, cession.
Décisions tranchées ici (autonomie totale).

## Objectif
Tenir un **registre d'immobilisations** et **amortir** (linéaire) en postant au grand livre `Dr Dotation aux amortissements / Cr Amortissement cumulé` — écriture toujours équilibrée, idempotente par (actif, période).

## Décision de conception clé (auto-cohérence GL)
Le module poste **UNIQUEMENT l'amortissement**. Il **ne capitalise PAS** l'acquisition au GL (l'achat de l'actif a été enregistré ailleurs — facture/paiement). Le `cost`/valeur nette vivent dans le **registre** (sous-livre). Conséquence : l'écriture d'amortissement (Dr charge / Cr amort. cumulé) est équilibrée et auto-suffisante quelle que soit la capitalisation. La **cession v1 = statut seulement (pas de GL)** — l'écriture de cession (qui dépendrait de la capitalisation) est reportée. C'est documenté comme simplification v1 honnête.

## Périmètre v1 (décidé)
**Inclus :**
- `FixedAsset` (registre tenant-scopé) : `name`, `assetCode`, `category` (string), `acquisitionDate`, `cost` (Decimal), `salvageValue` (Decimal défaut 0), `usefulLifeMonths` (int), `method DepreciationMethod` (STRAIGHT_LINE v1), `status FixedAssetStatus` (DRAFT/ACTIVE/DISPOSED), `accumulatedDepreciation` (Decimal courant, défaut 0), comptes : `depreciationExpenseAccountCode` (défaut `5100`), `accumulatedDepreciationAccountCode` (défaut `1590`).
- `DepreciationEntry` : `assetId`, `period` (DateTime, 1er du mois), `amount` (Decimal), `postedAt`. Unique `(tenantId, assetId, period)` → idempotence.
- **Amortissement linéaire** : mensuel = `(cost − salvage) / usefulLifeMonths` (dernière période absorbe l'arrondi). « Run » sur une période ACTIVE → poste GL (transactionnel avec la création de l'entry), incrémente `accumulatedDepreciation`, sans dépasser `cost − salvage`.
- **Statut** : `DRAFT→ACTIVE→DISPOSED` via `canTransitionFixedAsset` (règle 2). Amortit seulement si ACTIVE. Cession (`dispose`) = passe DISPOSED (statut seulement, pas de GL v1).
- `GET :id/schedule` : calendrier d'amortissement prévisionnel (helper pur).
- UI `/billing/fixed-assets`.

**Reporté :** méthodes dégressives, GL de capitalisation + cession (gain/perte/produit), catégories d'actifs comme entité, amortissement automatique par cron.

## Modèle de données (Prisma)
```prisma
enum DepreciationMethod { STRAIGHT_LINE }
enum FixedAssetStatus  { DRAFT  ACTIVE  DISPOSED }

model FixedAsset {
  id              String   @id @default(cuid())
  tenantId        String
  assetCode       String
  name            String
  category        String?
  acquisitionDate DateTime
  cost            Decimal  @db.Decimal(12, 2)
  salvageValue    Decimal  @default(0) @db.Decimal(12, 2)
  usefulLifeMonths Int
  method          DepreciationMethod @default(STRAIGHT_LINE)
  status          FixedAssetStatus   @default(DRAFT)
  accumulatedDepreciation Decimal @default(0) @db.Decimal(12, 2)
  depreciationExpenseAccountCode      String @default("5100")
  accumulatedDepreciationAccountCode  String @default("1590")
  disposedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  depreciations   DepreciationEntry[]
  @@unique([tenantId, assetCode])
  @@index([tenantId, status])
  @@map("fixed_assets")
}

model DepreciationEntry {
  id        String   @id @default(cuid())
  tenantId  String
  assetId   String
  period    DateTime
  amount    Decimal  @db.Decimal(12, 2)
  postedAt  DateTime @default(now())
  asset     FixedAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)
  @@unique([tenantId, assetId, period])
  @@index([tenantId, assetId])
  @@map("depreciation_entries")
}
```
+ `Tenant.fixedAssets FixedAsset[]`. Enums miroir shared↔Prisma.

## Plan comptable (étendre DEFAULT_CHART, `@pulsar/shared`)
- `1500` « Immobilisations » (ASSET).
- `1590` « Amortissement cumulé » (ASSET — contra ; naturalBalance ASSET = débit−crédit, donc un crédit d'amort. réduit l'actif net au bilan : correct).
- `5100` « Dotation aux amortissements » (EXPENSE).

## Helpers purs + state machine (`packages/shared/src/billing/assets.ts`)
```ts
export enum DepreciationMethod { STRAIGHT_LINE = 'STRAIGHT_LINE' }
export enum FixedAssetStatus { DRAFT='DRAFT', ACTIVE='ACTIVE', DISPOSED='DISPOSED' }
export const FIXED_ASSET_TRANSITIONS: Record<FixedAssetStatus, FixedAssetStatus[]> = {
  DRAFT: [ACTIVE, DISPOSED], ACTIVE: [DISPOSED], DISPOSED: [],
};
export function canTransitionFixedAsset(from, to): boolean;
export interface DepreciationScheduleRow { period: number; amount: number; accumulated: number; bookValue: number }
/** Linéaire : monthly = round2((cost−salvage)/life). La dernière période absorbe l'arrondi pour finir net exactement à salvage. bookValue = cost − accumulated. */
export function buildDepreciationSchedule(input: { cost: number; salvageValue: number; usefulLifeMonths: number }): DepreciationScheduleRow[];
/** Montant d'amortissement pour la prochaine période, plafonné pour ne jamais dépasser (cost−salvage). */
export function depreciationForNextPeriod(input: { cost: number; salvageValue: number; usefulLifeMonths: number; accumulated: number }): number;
```

## API (`/billing/fixed-assets`)
`FixedAssetsController` (`@RequireModule(BILLING)`, nouvelles permissions `billing.assets.read|manage`) :
- `GET/POST/PATCH/DELETE /billing/fixed-assets` (DELETE DRAFT only).
- `GET /billing/fixed-assets/:id/schedule` → `buildDepreciationSchedule`.
- `POST /billing/fixed-assets/:id/activate` (DRAFT→ACTIVE via canTransition + claim).
- `POST /billing/fixed-assets/:id/depreciate { period }` : actif ACTIVE ; `amount = depreciationForNextPeriod(...)` ; si `amount<=0` (déjà amorti) → 400 ; **transaction** : créer `DepreciationEntry` (unique (tenant,asset,period) ; P2002 → 409 « période déjà amortie »), incrémenter `accumulatedDepreciation`, poster GL via `LedgerService.postTx` (Dr `depreciationExpenseAccountCode` / Cr `accumulatedDepreciationAccountCode`, `sourceType='depreciation'`, `sourceId=entry.id`) — équilibré, idempotent (règle 41). Audit (règle 6).
- `POST /billing/fixed-assets/:id/dispose` (ACTIVE/DRAFT→DISPOSED via canTransition + claim ; statut seulement, pas de GL v1). Audit.

`FixedAssetsService` : CRUD + transitions via `canTransitionFixedAsset` + claim `updateMany` (TOCTOU). Tenant isolation (règle 1), FK/accountCodes (règle 9). N° d'actif : fourni par l'utilisateur (assetCode unique par tenant) — pas de SequencesService v1.

## UI Web
`/billing/fixed-assets` : liste (code, nom, coût, amort. cumulé, valeur nette = cost−accumulated, statut badge) ; create/edit modal ; détail/aperçu calendrier (`schedule`) ; actions activate / depreciate (saisir période) / dispose selon statut. Nav « Immobilisations » sous Finance (`billing.assets.read`). Number-coerce ; tones valides ; **aligner DTO + grep**.

## Tests
- Unit shared : `buildDepreciationSchedule` (somme = cost−salvage, dernière période absorbe l'arrondi, bookValue), `depreciationForNextPeriod` (plafond), `canTransitionFixedAsset`.
- e2e : créer un actif (cost 1200, salvage 0, life 12 → 100/mois) ; activate ; depreciate période M1 → DepreciationEntry + GL équilibré Dr 5100 100 / Cr 1590 100 + `accumulatedDepreciation`=100 ; re-depreciate même période → 409 ; schedule = 12×100 ; dispose → DISPOSED ; isolation tenant.

## Conformité hard rules
1 (tenant) · 2 (`canTransitionFixedAsset` + claim updateMany) · 3 (enums miroir) · 5 (`billing.assets.read|manage` + `@RequireModule(BILLING)`) · 6 (audit transitions + depreciate) · 9 (FK/comptes) · 41 (GL équilibré via `LedgerService.postTx`, transactionnel avec l'entry, idempotent `sourceType='depreciation'`). Helpers purs dans `@pulsar/shared`. Cession v1 = pas de GL (documenté). `accumulatedDepreciation` ne dépasse jamais `cost−salvage`.

## Préparation futur
Registre + calendrier map sur les Fixed Assets QuickBooks ; capitalisation/cession GL = extension future.
