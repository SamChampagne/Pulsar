# Billing — Ligne de facture libre + Grand Livre v1 (Cycle 7)

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée) ; branche `crm-email-threads`
**Module:** BILLING

## Objectif

(A) Débloquer l'itémisation des factures issues d'une commande CRM (gap Cycle 6) via une **ligne de
facture libre**. (B) Donner à Billing une **fondation comptable double-entrée (grand livre v1)** :
plan comptable, écritures de journal débit/crédit auto-postées depuis les jalons billing, balance
(trial balance), page dédiée, outils IA — mappings de comptes configurables.

## Partie A — Ligne de facture client libre

**Migration (additive)** sur `CustomerInvoiceLine` :
- `transportOrderId` → **nullable** (était NOT NULL `@unique` ; en Postgres un index unique autorise
  plusieurs NULL → les lignes libres coexistent ; les lignes TMS gardent l'unicité).
- `priceDetail` → **nullable** (était NOT NULL ; les lignes libres n'ont pas de snapshot de cote TMS).
- Nouveaux champs nullables : `source String?` ('transport-order' | 'sales-order'), `quantity
  Decimal?`, `unitPrice Decimal?`, `salesOrderLineId String?`.

**`createDraftFromSalesOrder` (Cycle 6) révisé** : crée de **vraies** `CustomerInvoiceLine`
(transportOrderId null, `source:'sales-order'`, salesOrderLineId, description=name, quantity,
unitPrice, amount=ligne total via `computeLineTotal`, priceDetail null) — fini le header-seul. Garde
l'idempotence (customData.salesOrderId) et `totalAmount = sumLineItems`.

**Garde-fous downstream (R10/affichage)** : tout code qui suppose `line.transportOrder(.orderNumber)`
non-null (rendu `send()`/PDF, `deleteDraft`, projections) doit gérer `transportOrderId === null`
(afficher `description` pour les lignes libres). Auditer et corriger ces points.

## Partie B — Grand Livre v1 (double-entrée)

### Modèles Prisma (additifs) + enums mirrorés (`@pulsar/shared`, règle 3)
- `enum AccountType { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE }`.
- `ChartOfAccount` : `id, tenantId, code (String), name, type (AccountType), active (bool def true),
  createdAt`. `@@unique([tenantId, code])`, `@@index([tenantId, type])`. (Le solde normal débit/crédit
  est **dérivé** du type, pur shared `normalBalance(type)` — jamais persisté.)
- `JournalEntry` : `id, tenantId, date (DateTime), memo (String?), sourceType (String?), sourceId
  (String?), createdById (String?), createdAt`. `@@index([tenantId, date])`,
  `@@index([tenantId, sourceType, sourceId])`.
- `JournalLine` : `id, tenantId, journalEntryId (FK cascade), accountId (FK ChartOfAccount), debit
  (Decimal def 0), credit (Decimal def 0), memo (String?)`. `@@index([tenantId, accountId])`,
  `@@index([tenantId, journalEntryId])`.
- Back-relations `Tenant`/`ChartOfAccount` explicites.

### Helpers purs (`packages/shared/src/billing/ledger.ts`, testés)
- `normalBalance(type: AccountType): 'DEBIT' | 'CREDIT'` (ASSET/EXPENSE→DEBIT ; LIABILITY/EQUITY/
  REVENUE→CREDIT).
- `isBalanced(lines: { debit: number; credit: number }[]): boolean` (Σdebit === Σcredit, arrondi 2
  décimales, et au moins 2 lignes, et chaque ligne a exactement un côté non nul).
- `DEFAULT_CHART: { code, name, type }[]` (plan comptable de base : 1000 Encaisse [ASSET],
  1100 Clients/AR [ASSET], 2000 Fournisseurs/AP [LIABILITY], 2100 Taxes à payer [LIABILITY],
  4000 Revenus transport [REVENUE], 5000 Charges transporteurs [EXPENSE], 3000 Capital [EQUITY]…).

### `LedgerService` (`apps/api/src/modules/billing/ledger/`)
- `post(tenantId, { date, memo, sourceType, sourceId, kind, lines: [{accountCode, debit, credit, memo?}] }, userId?)` :
  résout accountCode→accountId (tenant), valide `isBalanced`, **idempotent** sur
  `(tenantId, sourceType, sourceId, kind)` (skip si une écriture existe déjà avec ce memo/sourceRef ;
  stocker `kind` dans `memo` ou un champ `sourceKind` — ajouter `sourceKind String?` au modèle pour
  une idempotence propre), persiste `JournalEntry`+`JournalLines` en transaction, audit (règle 6).
  Best-effort si appelé en postage auto : un échec de postage ne casse pas la transition billing.
- `trialBalance(tenantId, asOf?)` : Σ débits/crédits par compte (lecture), retourne par compte
  `{ code, name, type, debit, credit, balance }` + totaux (Σdébit === Σcrédit).
- `ensureChart(tenantId)` : seed le `DEFAULT_CHART` pour le tenant s'il est vide (idempotent).

### Postage automatique (depuis les transitions billing, best-effort, idempotent)
Dans les services billing, APRÈS le claim de statut réussi (règle 2), appeler `LedgerService.post`
(best-effort, try/catch — n'altère jamais la transition) avec les mappings **configurables** :
- `CustomerInvoice` → APPROVED : DR `arAccount` / CR `revenueAccount` (totalAmount). PAID : DR
  `cashAccount` / CR `arAccount`.
- `Invoice` (buy-side carrier) → APPROVED : DR `expenseAccount` / CR `apAccount`. PAID : DR
  `apAccount` / CR `cashAccount`.
- (Freight audit / taxes : backlog.)

### Réglages configurables (module-settings billing, règles 35/36)
`ledgerAutoPost` (bool, def true), `arAccountCode` (def '1100'), `revenueAccountCode` ('4000'),
`cashAccountCode` ('1000'), `apAccountCode` ('2000'), `expenseAccountCode` ('5000'). Si
`ledgerAutoPost=false`, aucun postage auto.

### API (`@RequireModule(BILLING)`, R1)
- `GET /billing/ledger/accounts` (chart, seed via `ensureChart` au 1er accès) | `billing.ledger.read`
- `GET /billing/ledger/journal` (`Paginated` écritures + lignes, filtre date/account) | `billing.ledger.read`
- `GET /billing/ledger/trial-balance?asOf=` | `billing.ledger.read`
- `POST /billing/ledger/entries` (écriture manuelle équilibrée d'ajustement) | `billing.ledger.manage`
- Permissions nouvelles `billing.ledger.read|manage` (catalogue + seed).

### IA (registre, R21)
- `get_trial_balance` (READ), `list_journal_entries` (READ) → `LedgerService`. Preset rôle Finance
  Analyst gagne `billing.ledger.read`.

### Web
- `/billing/ledger` : onglets **Plan comptable** (liste comptes) / **Journal** (écritures + lignes
  DR/CR) / **Balance** (trial balance, Σ débit = Σ crédit). Lien depuis la nav Billing. FR.

## Conformité hard rules
R1, R2 (postage après claim), R3 (enum AccountType mirroré), R6 (audit écritures), R8 (n° si requis —
ici écritures non numérotées par séquence, ok), R16/36 (montants depuis snapshots/lignes, jamais de
recompute figé ; defaultCurrency), R35/36 (mappings configurables). Postage auto **best-effort**
(jamais bloquant) mais **idempotent** (intégrité : pas de double-écriture). Double-entrée garantie
par `isBalanced` au point d'écriture unique (`LedgerService.post`).

## Tests
- **Unit (`@pulsar/shared`)** : `normalBalance`, `isBalanced` (équilibré / déséquilibré / lignes
  une-seule-colonne), forme `DEFAULT_CHART`.
- **e2e (`apps/api/test/billing-ledger.e2e-spec.ts`)** : ensureChart seed ; facture client APPROVED
  → écriture DR AR/CR Revenue balancée ; PAID → DR Cash/CR AR ; idempotence (re-transition ne
  double-poste pas) ; trial-balance Σdébit===Σcrédit ; écriture manuelle déséquilibrée rejetée (400) ;
  facture issue d'une commande CRM → lignes libres présentes (Partie A) ; isolation tenant.

## Hors périmètre v1 (backlog, Cycle 9+)
Taxes (TPS/TVQ) + journaux de taxe, modèle `Payment` (paiements partiels), AR/AP aging, périodes
comptables + verrouillage, états financiers (P&L, bilan, flux), multi-devise consolidée, export
QuickBooks/Sage, freight-audit → ledger.
