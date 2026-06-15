# Phase 16 — Freight Audit autonome — Design

> Statut : approuvé (brainstorm 2026-06-15). Acte II de la roadmap Pulsar Agent OS
> ([roadmap](./2026-06-14-pulsar-agent-os-roadmap.md), §19.4). Premier « agent phare » : profondeur
> + ROI sur un module existant (Billing). Sam a délégué toutes les décisions de l'Acte II — les
> choix ci-dessous sont tranchés en faveur du sens métier + de la robustesse.

## Objectif

Auditer automatiquement les factures que les transporteurs nous envoient contre ce qu'on
s'attendait à payer (`Load.estimatedCost` figé), détecter les surfacturations, ouvrir les litiges
via le Workbench gouverné, et **mesurer les économies récupérées** — le vrai chiffre $ que le
Control Tower (phase 15) avait différé. C'est le ROI le plus vendable d'un TMS (2-5 % des montants
transport).

## Contexte réutilisé (ne PAS reconstruire)

- **Buy-side billing (phases 5/6)** : `Invoice` interne (brouillon regroupant les `Load` COMPLETED
  d'un carrier, 1 ligne/load = `estimatedCost`), `reconcile()` humain qui saisit les montants
  réellement facturés → variance brute → tolérance → APPROVED/DISPUTED, workflow de litige
  (`ResolveDisputeDto` : `resolution` ACCEPT_INVOICED|KEEP_EXPECTED, `reasonCode`, `note`), PAID, CSV.
  **Phase 16 NE touche PAS ce flux** — il reste le settlement interne.
- **`evaluateReconciliation(lines: {expected, invoiced}[], {tolerancePct, toleranceAbsolute})`**
  (`@pulsar/shared/billing/reconciliation.ts`, pur) → `{invoicedTotal, varianceTotal, varianceGross,
  withinTolerance}`. **Réutilisé tel quel** pour le matching freight-audit (seuil = gross variance).
- **Tolérances tenant** depuis `TenantModule.settings` (billing, défauts 2 % / 25) — même source.
- **`Load`** : `loadNumber`, `estimatedCost` (Decimal, figé règle 16), `costCurrency`, `carrierId`,
  `status` COMPLETED.
- **Substrat agents (11→15)** : registre d'outils + gate policy (`handleMutatingTool`), file
  `ProposedAction`, `DomainEvent` + policies → `OperationalTask`, worker always-on, KPIs/trust.
- **`OperationalTaskType.EXCEPTION`** (seul type ; on ajoute la **category** `FREIGHT_AUDIT`).

## Décisions verrouillées

1. **Entité découplée** : `IncomingCarrierInvoice` + `IncomingInvoiceLine` (≠ le brouillon `Invoice`
   interne). Robuste : la facture du transporteur peut mal mapper, arriver en décalage, facturer
   l'inconnu.
2. **Ingestion structurée** (create manuel/API). OCR/PDF/EDI → phase 18. Le matching est la valeur.
3. **Matching = service déterministe** ; l'agent décide/explique et propose, **ne calcule jamais**.
4. **Réutiliser la LOGIQUE de rapprochement** (`evaluateReconciliation`, reason codes,
   ACCEPT_CHARGED/KEEP_EXPECTED), pas l'entité `Invoice`.
5. **Une seule phase cohérente** incluant l'agent (réutilise le substrat → peu de code neuf).
6. **`Load.estimatedCost` jamais recalculé** (règle 16) ; devise identique exigée (sinon ligne
   `FLAGGED` non vérifiable) ; `carrierId` fourni à l'intake (pas de matching flou par nom).

## Architecture

### A. Entités (24ᵉ migration ; module Billing)

**`IncomingCarrierInvoice`** :
`id, tenantId, carrierId (FK Carrier), carrierInvoiceNumber (string), currency, chargedTotal
(Decimal), receivedAt (DateTime), status (FreightAuditStatus @default(RECEIVED)), matchedTotal
(Decimal?), varianceTotal (Decimal?), varianceGross (Decimal?), recoveredAmount (Decimal @default(0)),
resolution (string?), disputeReasonCode (string?), disputeNote (string?), auditedAt?, resolvedAt?,
paidAt?, sourceRef (string @default("manual")), disputedByAgentId (string?), createdById (string?),
createdAt`. Index `@@index([tenantId, status])`. `@@map("incoming_carrier_invoices")`.

**`IncomingInvoiceLine`** (= « expédition importée ») :
`id, invoiceId (FK cascade), lineRef (string — n° de load / PRO du transporteur), description
(string?), chargedAmount (Decimal), matchedLoadId (string?), expectedAmount (Decimal?) — snapshot
`Load.estimatedCost` au match, variance (Decimal?)`. Index `@@index([invoiceId])`.
`@@map("incoming_invoice_lines")`.

### B. Machine d'états (`@pulsar/shared/workflows/freight-audit.workflow.ts`)

```ts
export enum FreightAuditStatus { RECEIVED, MATCHED, FLAGGED, DISPUTED, RESOLVED, PAID }
export function canTransitionFreightAudit(from, to): boolean
```
Transitions : `RECEIVED → MATCHED | FLAGGED` (audit) ; `FLAGGED → DISPUTED | RESOLVED` ;
`DISPUTED → RESOLVED` ; `MATCHED | RESOLVED → PAID`. Pure, mirroir Prisma (enum). Tests unit purs.

`recoveredAmount` = `varianceTotal` (surfacturation évitée) quand `resolution = 'KEEP_EXPECTED'` ;
`0` quand `ACCEPT_CHARGED`. `MATCHED` = dans tolérance, payable au montant chargé.

### C. Moteur de matching (`FreightAuditService`, déterministe)

`audit(tenantId, userId, invoiceId)` :
1. Charge l'invoice + lignes ; statut doit être `RECEIVED` (ou re-audit depuis `FLAGGED` après
   correction — `updateMany` conditionnel TOCTOU comme `reconcile`).
2. Pour chaque ligne : résout `lineRef` → `Load` via `loadNumber` **scopé `tenantId` + `carrierId`**
   (le load doit appartenir au tenant ET au transporteur de la facture). Si trouvé :
   `matchedLoadId`, `expectedAmount = Load.estimatedCost` (jamais recalculé), `variance = chargé −
   attendu`. Si non trouvé : `matchedLoadId = null`, `expectedAmount = null` (ligne non vérifiable).
3. Agrège via **`evaluateReconciliation`** sur les lignes matchées (`{expected, invoiced: chargé}`).
   Les lignes NON matchées ajoutent leur `chargedAmount` à un « unmatchedTotal » et forcent `FLAGGED`
   (on ne paie pas l'invérifiable à l'aveugle).
4. `status = FLAGGED` si `!withinTolerance` OU lignes non matchées présentes ; sinon `MATCHED`.
   Stocke `matchedTotal/varianceTotal/varianceGross/auditedAt`. Audit log + `DomainEvent`
   `carrier-invoice.audited` (best-effort).
Transaction : updates de lignes + header conditionnel sur le statut attendu (race-safe).

`dispute(tenantId, actorId, invoiceId, {reasonCode, note})` : `FLAGGED → DISPUTED`, conditionnel,
audité, `disputedByAgentId` si l'acteur est un service-user d'agent (sinon null). `resolve(...,
{resolution, reasonCode, note})` : `DISPUTED → RESOLVED`, set `recoveredAmount` selon résolution,
audité. `markPaid(...)` : `MATCHED|RESOLVED → PAID`. Toutes via `canTransitionFreightAudit` (règle 2)
+ `AuditLogsService.log` (règle 6).

### D. Agent d'audit autonome (réutilise le substrat 11→15)

- **Intake** `POST /freight-audit/incoming-invoices` → crée l'entité (`RECEIVED`) → `DomainEventsService.emit('carrier-invoice.received', {invoiceId, carrierId})` (best-effort).
- **Policy phase-12** (`@pulsar/shared/operating/policies.ts`) : `carrier-invoice.received` →
  `TaskSpec { type: EXCEPTION, category: 'FREIGHT_AUDIT', severity: 'WARNING', subjectType:
  'incoming-carrier-invoice', subjectId: invoiceId, dedupKey: 'FREIGHT_AUDIT:<invoiceId>',
  assignHint: 'AUTO' }`. `DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED` ajouté au catalogue.
- **2 outils** (`core/agents/tool-registry.ts`, via l'adaptateur `ToolServices` → `FreightAuditService`) :
  - `audit_carrier_invoice` (tier **READ**, perm `billing.freight-audit.read`, module BILLING) —
    lance `audit()`, renvoie le résumé (status, varianceGross, lignes flaguées). *Idempotent : si déjà audité, renvoie l'état.*
  - `dispute_carrier_invoice` (tier **SENSITIVE**, perm `billing.freight-audit.manage`, module
    BILLING) — ouvre le litige ; **passe par le gate `handleMutatingTool`** (phase 14) → `ProposedAction`
    (`triggeredByRef = "task:<id>"` porté par le jeton de session) ; `amountFrom` = `varianceTotal`
    pour le cap montant.
- L'agent always-on (worker phase-13) est réveillé par la tâche, appelle `audit_carrier_invoice`,
  et si `FLAGGED` propose `dispute_carrier_invoice` (auto vs propose selon autonomie/policy phase 14 —
  les caps bornent). **Zéro plomberie runtime neuve.**

### E. KPI économies récupérées (rebranche le Control Tower phase 15)

`recoveredAmount` est attribué via `IncomingCarrierInvoice.disputedByAgentId`. Endpoint
`GET /freight-audit/savings?days=30` → `{ tenantTotal, byAgent: [{agentId, recovered}], invoices:
{audited, flagged, disputed, resolved} }` (somme `recoveredAmount` des RESOLVED dans la fenêtre).
C'est le **vrai montant $** différé en phase 15. (Intégration légère : un endpoint dédié ; le
branchement dans le KPI agent du Control Tower peut suivre — ici on expose la donnée honnête.)

### F. API + permissions + Web

- Controller `FreightAuditController` (`@RequireModule(MODULE_KEYS.BILLING)`), routes sous
  `/freight-audit/incoming-invoices` : `POST` (create+intake), `GET` (list, filtre status), `GET :id`,
  `POST :id/audit`, `POST :id/dispute`, `POST :id/resolve`, `POST :id/pay` ; `GET /freight-audit/savings`.
  Chaque endpoint `@RequirePermissions(billing.freight-audit.read|manage)`.
- 2 permissions `billing.freight-audit.read|manage` (`@pulsar/shared/permissions.ts`, catalogue → seed).
- Web : page `/billing/freight-audit` (liste factures entrantes + statut/variance) + détail (matching
  ligne par ligne, variance, actions audit/dispute/resolve/pay) + bandeau économies récupérées. Nav
  conditionnée sur `enabledModules` BILLING. Pattern web existant.

### G. Règle dure 31 (CLAUDE.md, phase 16)

> **31. (phase 16 — Freight Audit)** L'audit de facture transporteur entrante (`IncomingCarrierInvoice`)
> matche chaque ligne contre `Load.estimatedCost` **figé** (jamais recalculé — règle 16), via le
> service déterministe `FreightAuditService` ; l'agent ne calcule jamais les variances, il propose.
> Les transitions passent par `canTransitionFreightAudit` (`@pulsar/shared`, règle 2) ; le matching
> réutilise `evaluateReconciliation` + les tolérances buy-side (jamais réimplémenté). L'ouverture de
> litige par un agent passe TOUJOURS par le gate `handleMutatingTool` → `ProposedAction`
> (`triggeredByRef = "task:<id>"`, tier SENSITIVE, cap montant sur `varianceTotal`) — règles 22/29.
> `recoveredAmount` n'est positif que sur une résolution `KEEP_EXPECTED` ; il alimente le KPI
> économies. Tenant isolation (règle 1) + module gating (`@RequireModule(BILLING)`) sur tout endpoint.

## Tests

Unit (`@pulsar/shared`, vitest) : `canTransitionFreightAudit` (transitions valides/invalides).
Unit (API) : `FreightAuditService.audit` (résolution ligne→load, variance, MATCHED vs FLAGGED, ligne
non matchée force FLAGGED, `estimatedCost` lu jamais recalculé) ; `dispute`/`resolve` (transitions +
`recoveredAmount` selon résolution) ; les 2 outils (audit READ direct ; dispute SENSITIVE → file).
E2e (DB seedée, faux Hermes) :
1. Intake d'une facture entrante avec 2 lignes (une dans tolérance, une surfacturée) → `POST :id/audit`
   → `FLAGGED`, variance correcte, lignes matchées aux loads.
2. `dispute` → `DISPUTED` ; `resolve KEEP_EXPECTED` → `RESOLVED`, `recoveredAmount = varianceTotal`.
3. `GET /freight-audit/savings` → `tenantTotal >= recoveredAmount`.
4. Chemin agent : intake → `DomainEvent` → `processPending` → `OperationalTask FREIGHT_AUDIT` assignée
   à l'agent always-on → l'agent (faux Hermes) appelle `audit_carrier_invoice` puis propose
   `dispute_carrier_invoice` → `ProposedAction` PENDING `triggeredByRef = task:<id>` (tier SENSITIVE).
5. Ligne référençant un load d'un AUTRE transporteur/tenant → non matchée (isolation).
6. Projection : pas de fuite ; `Load.estimatedCost` inchangé après audit (règle 16).

## Hors périmètre

OCR/PDF/EDI ingestion (phase 18) · matching flou par nom de transporteur · conversion multi-devises ·
re-rating / recompute de coût (règle 16) · planification continue (phase 17) · intégration profonde
du $ dans chaque KPI agent du Control Tower (endpoint savings dédié suffit pour cette phase).
