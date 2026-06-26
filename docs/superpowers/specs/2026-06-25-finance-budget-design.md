# Finance — Sous-projet #5 : Budget — Design

Date : 2026-06-25 · Module `billing`. Inspiration ERPNext : Budget (par compte/centre de coûts/période) + Rapport d'écarts de budget.
Décisions tranchées ici (autonomie totale).

## Objectif
Définir des **budgets annuels par compte** (revenus/charges) et afficher l'**écart budget-vs-réel** — le réel calculé à la lecture depuis le grand livre (comme les Rapports). Aucune écriture GL.

## Périmètre v1 (décidé)
**Inclus :**
- `Budget` (tenant-scopé) : `name`, `fiscalYear` (int, ex 2026), `isActive`.
- `BudgetLine` : `budgetId`, `accountCode` (compte GL budgété), `amount` (montant annuel budgété, Decimal(12,2)).
- **Variance** : pour chaque ligne, `actual` = `naturalBalance` du compte sur l'exercice (`[fiscalYear-01-01, fiscalYear-12-31]`) agrégé depuis `JournalLine` ; `variance = budget − actual` ; `variancePct`. Calculé à la lecture.
- UI `/billing/budgets` : liste, édition des lignes, vue d'écarts.

**Reporté :** budgets mensuels/répartition, centres de coûts, alertes de dépassement, contrôle bloquant à l'engagement.

## Modèle de données (Prisma)
```prisma
model Budget {
  id         String   @id @default(cuid())
  tenantId   String
  name       String
  fiscalYear Int
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  lines      BudgetLine[]
  @@unique([tenantId, name, fiscalYear])
  @@index([tenantId, fiscalYear])
  @@map("budgets")
}
model BudgetLine {
  id          String  @id @default(cuid())
  tenantId    String
  budgetId    String
  accountCode String
  amount      Decimal @db.Decimal(12, 2)
  budget      Budget  @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  @@index([tenantId, budgetId])
  @@map("budget_lines")
}
```
+ `Tenant.budgets Budget[]`. Pas d'enum.

## Helper pur (`packages/shared/src/billing/budget.ts`)
```ts
export interface BudgetVarianceInput { accountCode: string; name: string; budget: number; actual: number }
export interface BudgetVarianceRow { accountCode: string; name: string; budget: number; actual: number; variance: number; variancePct: number }
/** variance = budget − actual ; variancePct = budget!==0 ? round2(variance/|budget|*100) : 0. round2 partout. */
export function computeBudgetVariance(inputs: BudgetVarianceInput[]): { rows: BudgetVarianceRow[]; totalBudget: number; totalActual: number; totalVariance: number };
```

## API (`/billing/budgets`)
`BudgetsController` (`@RequireModule(BILLING)`, **réutilise `billing.ledger.read|manage`**) :
- `GET/POST/PATCH/DELETE /billing/budgets` (lignes incluses ; PATCH remplace les lignes).
- `GET /billing/budgets/:id/variance` → `computeBudgetVariance` : pour chaque ligne, charger le compte (nom via `ChartOfAccount`), agréger `JournalLine` sur l'exercice (`entry.date` ∈ [fiscalYear-01-01, fiscalYear-12-31 fin de journée]) → `naturalBalance` (réutilise `naturalBalance` de `@pulsar/shared`).

`BudgetsService` : CRUD tenant-scopé (claim ownership avant mutate) ; variance lit le GL (aucune écriture). Tenant isolation (règle 1), FK vérifiées (règle 9).

## UI Web
`/billing/budgets` : liste des budgets (nom, exercice, actif, total budgété) ; éditeur (nom, exercice, lignes compte+montant répétables) ; vue d'écarts (tableau compte / budgété / réel / écart / écart% avec tons : sur-budget réel>budget pour une charge = danger, sinon ok). Nav « Budgets » sous Finance (`ledger.read`). Number-coerce ; tons valides ; **aligner les types au DTO réel + grep**.

## Tests
- Unit shared : `computeBudgetVariance` (variance, variancePct, budget=0→0%, totaux).
- e2e : créer un budget fiscalYear courant + 1 ligne (compte 5000 charges, budget 1000) ; approuver une facture transporteur qui poste DR 5000 (charge) ; `GET :id/variance` → actual reflète la charge, variance = 1000 − actual ; isolation tenant.

## Conformité hard rules
1 (tenant) · 5 (`@RequireModule(BILLING)` + `ledger.read|manage`) · 9 (FK budget). Helper pur dans `@pulsar/shared`. **Aucune écriture GL** (variance calculée à la lecture, réutilise `naturalBalance`). Pas de migration de rollup.

## Préparation futur
`Budget`+lignes map sur les budgets QuickBooks ; variance = même calcul read-time qu'un export.
