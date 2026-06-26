# Finance — Sous-projet #2 : Taxes — Design

Date : 2026-06-25
Module : `billing` (Finance/Comptabilité)
Séquence : Paiements ✅ → **Taxes** → Rapports.
Inspiration ERPNext : Modèle de Taxes et Frais (Vente/Achat), taux multi-lignes (Canada GST 5 % / HST 15 % / PST), compte de taxe par ligne.

Toutes les décisions de design sont tranchées ici (autonomie totale accordée par Sam — ne pas redemander).

## Objectif

Appliquer des **modèles de taxe** (multi-taux → comptes GL) aux factures client (vente) et transporteur (achat) : calcul du montant de taxe, ventilation stockée, total porté à net + taxe, et **écritures GL d'approbation scindées** (revenu net + taxe à payer ; charge nette + taxe à recouvrer).

## Périmètre v1 (décidé)

**Inclus :**
- `TaxTemplate` (SALES/PURCHASE, multi-lignes, isDefault) + `TaxTemplateLine` (description, rate %, accountCode).
- Helper pur `computeTax(net, lines)` (`@pulsar/shared`).
- `taxAmount` + `taxTemplateId` + `taxDetail` sur `CustomerInvoice` ET `Invoice` ; `totalAmount` = net + taxe.
- Application **explicite** via endpoint `PATCH …/:id/tax { taxTemplateId | null }` (DRAFT uniquement). **PAS d'auto-application** à la création (pour ne pas changer le total/GL des factures existantes — invariant « défauts = comportement actuel »). `isDefault` sert seulement à **pré-sélectionner** le template dans l'UI.
- GL d'approbation scindé (best-effort, idempotent — inchangé sur la mécanique, règle 41).
- CRUD des templates + seed Canada (GST 5 % défaut, HST 15 %, PST 9.975 %).
- UI : gestion des templates dans `/billing/config` + sélecteur + ventilation taxe sur les pages facture.

**Reporté :** Item Tax Template, Tax Category, Tax Rules (sélection auto par région/client), retenue à la source (TDS), taxe composée (QST-sur-GST). v1 = tous les taux appliqués **sur le net** (base plate), documenté.

## Modèle de données (Prisma)

```prisma
enum TaxTemplateType { SALES  PURCHASE }

model TaxTemplate {
  id        String            @id @default(cuid())
  tenantId  String
  name      String
  type      TaxTemplateType
  isDefault Boolean           @default(false)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  tenant    Tenant            @relation(fields: [tenantId], references: [id])
  lines     TaxTemplateLine[]
  @@unique([tenantId, name])
  @@index([tenantId, type])
  @@map("tax_templates")
}

model TaxTemplateLine {
  id          String  @id @default(cuid())
  tenantId    String
  templateId  String
  description String
  rate        Decimal @db.Decimal(7, 4)   // pourcentage, ex 5.0000, 9.9750
  accountCode String                       // compte GL de taxe (liability pour SALES, asset pour PURCHASE)
  sortOrder   Int     @default(0)
  template    TaxTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  @@index([tenantId, templateId])
  @@map("tax_template_lines")
}
```

**Ajouts factures :**
- `CustomerInvoice` : `taxAmount Decimal @default(0) @db.Decimal(12,2)`, `taxTemplateId String?`, `taxDetail Json?`.
- `Invoice` : idem.
- `totalAmount` = **net + taxAmount** (GROSS, montant dû). Sans template : taxAmount=0, total=net (comportement actuel inchangé). Le net est récupérable = `totalAmount − taxAmount` (pas de colonne netAmount).

Enum miroir shared↔Prisma (règle 3).

## Helper pur (`packages/shared/src/billing/tax.ts`)

```ts
export interface TaxLineInput { description: string; rate: number; accountCode: string }
export interface TaxBreakdownLine { description: string; rate: number; accountCode: string; amount: number }
export interface TaxComputation { taxAmount: number; lines: TaxBreakdownLine[] }

/** v1: every rate applied to the same net base (flat). amounts rounded to 2dp. */
export function computeTax(net: number, lines: TaxLineInput[]): TaxComputation;
```
- `round2` chaque montant de ligne ; `taxAmount` = somme des montants de ligne (arrondis).
- Tableau vide → `{ taxAmount: 0, lines: [] }`.

## Flux d'application

- **createDraft** (customer + carrier) : **inchangé** — la facture est créée sans taxe (taxAmount=0, total=net). Aucune auto-application (préserve les totaux/GL des factures existantes et des suites e2e).
- **PATCH /billing/customer-invoices/:id/tax** et **PATCH /billing/invoices/:id/tax** (`{ taxTemplateId: string | null }`) — DRAFT uniquement, **seul** point d'application :
  - `net = totalAmount − taxAmount` (récupère le net courant).
  - `null` → taxAmount=0, taxDetail=null, taxTemplateId=null, total=net.
  - sinon valider l'ownership du template (règle 9) + type correct (SALES pour customer, PURCHASE pour carrier) → recompute → écrire.
  - Audit (règle 6).

## GL d'approbation (étendu — best-effort, idempotent, règle 41)

**Customer (sourceType='customer-invoice', sourceKind='approved') :**
- `Dr AR = totalAmount` (gross)
- `Cr Revenue = totalAmount − taxAmount` (net)
- pour chaque ligne de `taxDetail` : `Cr <ligne.accountCode> = ligne.amount`
- Équilibré par construction (gross = net + Σ taxe). Si taxAmount=0 → réduit à DR AR/CR Revenue (inchangé).

**Carrier (sourceType='invoice', sourceKind='approved') :**
- `Dr Expense = totalAmount − taxAmount` (net)
- pour chaque ligne de `taxDetail` : `Dr <ligne.accountCode> = ligne.amount` (taxe à recouvrer)
- `Cr AP = totalAmount` (gross)

La mécanique reste l'auto-post best-effort existant (try/catch, jamais bloquant ; `ledgerAutoPost`). Le paiement (sous-projet #1) alloue contre `totalAmount` (gross) — inchangé.

## API REST

`TaxTemplatesController` (`@RequireModule(BILLING)`), nouvelles permissions `billing.taxes.read|manage` :
- `GET /billing/tax-templates?type=` — liste (avec lignes).
- `GET /billing/tax-templates/:id`
- `POST /billing/tax-templates` — `{ name, type, isDefault?, lines:[{description,rate,accountCode,sortOrder?}] }`. Poser isDefault retire le défaut des autres templates du même type (un seul défaut par type).
- `PATCH /billing/tax-templates/:id` — édite (remplace les lignes).
- `DELETE /billing/tax-templates/:id`.

Plus les deux endpoints `PATCH …/:id/tax` ci-dessus (gated `customer-invoices.manage` / `invoices.manage`).

Tenant-scopé (règle 1), FK vérifiées (règle 9).

## Plan comptable

Étendre `DEFAULT_CHART` (`@pulsar/shared`) avec deux comptes (seedés idempotemment, upsert `(tenantId, code)`) :
- `2150` « Taxes à payer » (LIABILITY) — comptes de ligne des templates SALES.
- `1150` « Taxes à recouvrer » (ASSET) — comptes de ligne des templates PURCHASE.

## Seed (tenant acme)

Templates SALES (upsert `(tenantId, name)`) :
- « Canada GST 5% » (défaut), ligne GST 5.0000 → 2150.
- « Canada HST 15% », ligne HST 15.0000 → 2150.
- « Québec GST+QST », lignes GST 5.0000 → 2150 et QST 9.9750 → 2150.
Template PURCHASE :
- « Achat GST 5% » (défaut), ligne GST 5.0000 → 1150.

## UI Web

- `apps/web/src/lib/components/billing/TaxTemplates.svelte` — CRUD (nom, type, défaut, lignes éditables description/taux/compte). Monté sur `/billing/config`.
- Pages facture (`invoices` carrier + customer statements) : afficher net / taxe (ventilation) / total ; sur un DRAFT, sélecteur de template appelant `PATCH …/:id/tax`. Réutiliser le pattern existant ; tones valides ; Number-coerce les Decimals (strings).

## Tests

- **Unit shared** : `computeTax` (taux unique, multi-taux, vide, arrondi 2dp).
- **e2e** : créer un template SALES (GST 5%) ; créer une customer invoice (net 100) → taxAmount 5, total 105 ; approuver → écriture GL équilibrée DR AR 105 / CR Revenue 100 / CR 2150 5 ; PATCH tax → null → total 100, taxAmount 0 ; type mismatch (PURCHASE sur customer) → 400 ; isolation tenant. Carrier symétrique (DR Expense/DR 1150/CR AP).

## Conformité hard rules

1 (tenant) · 2 (statuts inchangés, pas de nouvelle transition) · 3 (enum miroir) · 5 (perms `billing.taxes.*` + `@RequireModule`) · 6 (audit application taxe) · 9 (FK template) · 36 (config) · 41 (GL équilibré, idempotent, best-effort). `computeTax` pur dans `@pulsar/shared`. `totalAmount` reste le montant dû (gross) → cohérent avec Paiements (allocation/AR gross) et la trial balance.

## Préparation futur (connecteurs)

`TaxTemplate` + lignes (taux + compte) map sur les Tax Codes/Rates QuickBooks ; taxe stockée explicitement par facture (`taxAmount`/`taxDetail`) → export propre.
