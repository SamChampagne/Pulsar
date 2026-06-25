# Finance — Sous-projet #3 : Rapports financiers — Design

Date : 2026-06-25
Module : `billing`. Séquence : Paiements ✅ → Taxes ✅ → **Rapports**.
Inspiration ERPNext : Bilan, Pertes et Profits, Flux de Trésorerie, Balance Générale, AR/AP Ageing.
Décisions tranchées ici (autonomie totale).

## Objectif

Ajouter les états financiers **calculés à la lecture** depuis le grand livre (`JournalLine`) et les factures — aucun store, aucune migration, aucune mutation. On a déjà la balance de vérification + le journal (cycle 7) ; on ajoute **P&L, Bilan, Flux de trésorerie, balance âgée AR, balance âgée AP**.

## Périmètre v1 (décidé)

**Inclus :**
- **Pertes & Profits** (période from→to) : revenus (REVENUE, solde créditeur) − charges (EXPENSE, solde débiteur) = résultat net, ventilé par compte.
- **Bilan** (asOf) : Actifs (ASSET) / Passifs (LIABILITY) / Capitaux (EQUITY) ; + **résultat de l'exercice** (P&L cumulé jusqu'à asOf) affiché à part (« Gain/Perte provisoire » façon ERPNext) ; vérifie Actif = Passif + Capitaux + Résultat.
- **Flux de trésorerie** (from→to) v1 simple : variation nette des comptes de **trésorerie** (codes `cashAccountCode` + `bankAccountCode` de la config billing) sur la période, ventilée par compte.
- **Balance âgée AR** (asOf) : factures client (`CustomerInvoice`) avec encours (`totalAmount − amountPaid > 0`), bucketées par âge (0-30 / 31-60 / 61-90 / 91-120 / 120+) selon la date de facture vs asOf, par client.
- **Balance âgée AP** (asOf) : idem pour les factures transporteur (`Invoice`), par transporteur.

**Reporté :** Customer/Supplier ledger détaillé, Consolidated/Custom report templates, cash flow indirect complet, dimensions/centres de coûts.

## Helpers purs (`packages/shared/src/billing/reports.ts`)

```ts
import { AccountType, normalBalance } from './ledger';

export interface AccountBalanceInput { code: string; name: string; type: AccountType | string; debit: number; credit: number }
export interface ReportLine { code: string; name: string; amount: number }   // amount = signed natural balance
export interface ProfitAndLoss { revenue: ReportLine[]; expense: ReportLine[]; totalRevenue: number; totalExpense: number; netIncome: number }
export interface BalanceSheet { assets: ReportLine[]; liabilities: ReportLine[]; equity: ReportLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; balanced: boolean }

/** natural balance of an account: debit-normal → debit−credit ; credit-normal → credit−debit. */
export function naturalBalance(input: AccountBalanceInput): number;
export function buildProfitAndLoss(rows: AccountBalanceInput[]): ProfitAndLoss;
export function buildBalanceSheet(rows: AccountBalanceInput[], netIncome: number): BalanceSheet;
// balanced = round2(totalAssets) === round2(totalLiabilities + totalEquity + netIncome)

export type AgingBucket = '0-30' | '31-60' | '61-90' | '91-120' | '120+';
export interface AgingItemInput { partyId: string; partyName: string; reference: string; date: string | Date; outstanding: number }
export interface AgingPartyRow { partyId: string; partyName: string; buckets: Record<AgingBucket, number>; total: number }
export interface AgingReport { rows: AgingPartyRow[]; totals: Record<AgingBucket, number>; grandTotal: number }
export function bucketForAge(days: number): AgingBucket;     // ≤30→0-30, ≤60→31-60, ≤90→61-90, ≤120→91-120, else 120+
export function buildAging(items: AgingItemInput[], asOf: Date): AgingReport;  // groups by partyId, sums outstanding into buckets
```
Tous purs, `round2` à 2dp, aucune dépendance Node.

## API (read-time, `LedgerController` étendu ou nouveau `ReportsController`)

Nouveau `ReportsController` (`@Controller('billing/reports')`, `@RequireModule(BILLING)`, **réutilise `PERMISSIONS.BILLING.LEDGER_READ`** — pas de nouvelle permission) :
- `GET /billing/reports/profit-and-loss?from=&to=`
- `GET /billing/reports/balance-sheet?asOf=`
- `GET /billing/reports/cash-flow?from=&to=`
- `GET /billing/reports/ar-aging?asOf=`
- `GET /billing/reports/ap-aging?asOf=`

`FinancialReportsService` (nouveau, dans le module billing) :
- P&L / Bilan / Cash Flow : `journalLine.findMany` tenant-scopé groupé par compte (réutilise l'agrégation de `LedgerService.trialBalance` ; filtre de dates : `entry.date` `gte from` / `lte toEndOfDay`). Pour le Bilan, `netIncome` = P&L cumulé (toutes dates ≤ asOf). Cash flow = filtre sur les comptes trésorerie (`cashAccountCode`/`bankAccountCode` résolus via `ModuleSettingsService`).
- AR/AP aging : `customerInvoice`/`invoice` tenant-scopés où `status` non DRAFT et `totalAmount − amountPaid > 0` ; mappe vers `AgingItemInput` (date = approvedAt ?? createdAt ; partyName = customer/carrier name) ; `buildAging(items, asOf)`.

Tenant-scopé (règle 1). Dates : normaliser `to`/`asOf` à fin de journée (comme trialBalance).

## UI Web

Nouvelle route `apps/web/src/routes/(app)/billing/reports/+page.svelte` — page à onglets : **P&L · Bilan · Flux de trésorerie · Âgé AR · Âgé AP**. Sélecteurs de dates (période from/to pour P&L/CF ; asOf pour Bilan/aging ; défauts : exercice courant / aujourd'hui). Tableaux par section + totaux ; badge « équilibré » sur le Bilan. `money()` Number-coerce. Nav : entrée « Rapports financiers » sous Finance/Billing (`LEDGER_READ`). Réutiliser le pattern de `/billing/ledger`.

## Tests

- **Unit shared** : `naturalBalance`, `buildProfitAndLoss` (revenus−charges=net), `buildBalanceSheet` (balanced incl. netIncome), `bucketForAge` (bornes), `buildAging` (regroupement + buckets).
- **e2e** : seed/poste des écritures (approuver une facture client taxée → AR/Revenue/Tax ; un paiement → cash/AR), puis : P&L sur la période montre le revenu net ; Bilan asOf équilibré (Actif = Passif+Capitaux+Résultat) ; cash flow montre le mouvement de trésorerie ; AR aging bucket une facture impayée dans 0-30 ; AP aging idem ; isolation tenant.

## Conformité hard rules

1 (tenant) · 5 (`@RequireModule(BILLING)` + `LEDGER_READ`) · 41 (lecture seule du GL, aucune écriture). Helpers purs dans `@pulsar/shared`. **Aucune migration, aucun store de rollup** (cohérent avec la trial balance et le Control Tower — calcul à la lecture). `normalBalance` réutilisé (jamais réimplémenté).

## Préparation futur (connecteurs)

P&L/Bilan calculés depuis un GL propre = exactement ce qu'un connecteur QuickBooks/export comptable consomme ; aucun travail spécifique maintenant.
