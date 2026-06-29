# Finance — Sous-projet #1 : Paiements (Payment Entry) — Design

Date : 2026-06-25
Module : `billing` (Finance/Comptabilité)
Séquence d'expansion : **Paiements** → Taxes → Rapports (cf. mémoire `pulsar-finance-erpnext-expansion`).
Référence d'inspiration : ERPNext « Comptabilité / Paiements » (Écriture de Paiement, allocation, Moyen de paiement, AR/AP ageing).

## Objectif

Remplacer le `mark-paid` rudimentaire (flip de statut + GL simpliste) par une **Écriture de Paiement
first-class** : un paiement (reçu d'un client ou versé à un transporteur) alloué à une ou plusieurs
factures ouvertes (partiel permis), posté en grand livre double-entrée, avec suivi de l'encours
(outstanding) par facture.

C'est le socle qui rend le GL existant réellement utilisable et prépare Taxes + Rapports (ageing).

## Périmètre v1 (validé : « cœur complet »)

**Inclus :**
- Entité `Payment` + `PaymentAllocation` + master `ModeOfPayment`.
- Allocation multi-factures, paiements partiels, suivi `amountPaid`/outstanding.
- Post GL idempotent à la soumission ; réécriture inverse à l'annulation.
- State machine `Payment` : `DRAFT → SUBMITTED → CANCELLED` (règle 2).
- UI `/billing/payments` (liste + KPI encours) + création guidée + détail.
- `mark-paid` (carrier + customer) **réécrit** pour créer un `Payment` plein sous le capot → un seul
  chemin comptable.

**Reporté (itérations Paiements ultérieures) :** Réconciliation des paiements (matcher des paiements
non-alloués après coup), Requête de paiement (lien de paiement), Ordre de paiement (lot fournisseur),
Repost ledger tools.

**Hors périmètre (autres sous-projets) :** AR/AP ageing → sous-projet Rapports. Taxes sur paiements
→ sous-projet Taxes.

## Modèle de données (Prisma — `packages/database`)

```prisma
enum PaymentType   { RECEIVE  PAY }                 // reçu client / versé transporteur
enum PaymentStatus { DRAFT  SUBMITTED  CANCELLED }
enum PaymentPartyType { CUSTOMER  CARRIER }
enum PaymentTargetType { CUSTOMER_INVOICE  CARRIER_INVOICE }

model ModeOfPayment {
  id          String   @id @default(cuid())
  tenantId    String
  name        String                       // « Espèces », « Banque », « Chèque »…
  accountCode String                       // compte GL (ChartOfAccount.code) débité/crédité
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  payments    Payment[]
  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("modes_of_payment")
}

model Payment {
  id              String          @id @default(cuid())
  tenantId        String
  paymentNumber   String                          // PAY- via SequencesService (règle 8)
  type            PaymentType
  status          PaymentStatus   @default(DRAFT)
  partyType       PaymentPartyType
  partyId         String                          // customerId | carrierId (vérifié règle 9)
  modeOfPaymentId String
  date            DateTime
  currency        String          @default("CAD")
  totalAmount     Decimal         @db.Decimal(12, 2)
  reference       String?                         // n° chèque / réf virement
  note            String?
  submittedAt     DateTime?
  cancelledAt     DateTime?
  createdById     String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  tenant          Tenant          @relation(fields: [tenantId], references: [id])
  modeOfPayment   ModeOfPayment   @relation(fields: [modeOfPaymentId], references: [id])
  allocations     PaymentAllocation[]
  @@unique([tenantId, paymentNumber])
  @@index([tenantId, status])
  @@index([tenantId, partyType, partyId])
  @@map("payments")
}

model PaymentAllocation {
  id         String            @id @default(cuid())
  tenantId   String
  paymentId  String
  targetType PaymentTargetType
  targetId   String                              // invoiceId | customerInvoiceId (vérifié règle 9)
  amount     Decimal           @db.Decimal(12, 2)
  payment    Payment           @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  @@index([tenantId, targetType, targetId])
  @@map("payment_allocations")
}
```

**Ajouts aux factures (suivi outstanding) :**
- `Invoice.amountPaid   Decimal @default(0) @db.Decimal(12,2)`
- `CustomerInvoice.amountPaid Decimal @default(0) @db.Decimal(12,2)`
- Outstanding = `totalAmount − amountPaid` (dérivé, jamais persisté).

Enums miroir dans `packages/shared` (règle 3) + state machine `canTransitionPayment` dans
`packages/shared/src/workflows`.

## Flux métier (`PaymentsService`)

1. **create (DRAFT)** : valide party (OwnershipService, règle 9), mode de paiement, devise.
   Les allocations sont saisies au DRAFT mais aucun effet comptable encore.
2. **Validation d'allocation** : pour chaque cible, `amount ≤ outstanding` de la facture ; somme des
   allocations `≤ totalAmount` du paiement ; cibles cohérentes avec `partyType` (CUSTOMER→customer
   invoices ; CARRIER→carrier invoices) et même devise.
3. **submit (DRAFT→SUBMITTED)** — transaction unique, claim conditionnel `updateMany` (TOCTOU) :
   - Poste le GL via `LedgerService.post` (idempotent, `sourceType='payment'`, `sourceId=payment.id`,
     `sourceKind=null`) :
     - **RECEIVE (client)** : `Dr <modeAccount>` / `Cr <arAccountCode>` — montant = total alloué.
     - **PAY (transporteur)** : `Dr <apAccountCode>` / `Cr <modeAccount>`.
   - Incrémente `amountPaid` de chaque facture allouée (dans la même transaction).
   - Facture soldée (`amountPaid ≥ totalAmount`) → transition `PAID` via `canTransition*` + `paidAt`.
     Partiel → la facture reste APPROVED/SENT avec `amountPaid > 0`.
   - Audit (règle 6).
4. **cancel (SUBMITTED→CANCELLED)** :
   - Poste une écriture **inverse** (idempotent, `sourceKind='reversal'`).
   - Décrémente `amountPaid` ; si une facture était PAID et redevient < total, transition retour
     (APPROVED/SENT) via `canTransition*`.
   - Audit.

**Compte du mode de paiement** : `ModeOfPayment.accountCode`. AR/AP viennent de la config billing
(`arAccountCode`/`apAccountCode`, règle 36). Nouveau code de config `bankAccountCode` (défaut `'1010'`)
pour seeder le mode « Banque » ; « Espèces » → `cashAccountCode` existant (`'1000'`).

**Migration de `mark-paid`** : les endpoints `POST :id/mark-paid` (carrier) et `:id/pay` (customer)
créent désormais un `Payment` plein (allocation unique = montant restant) puis `submit`. L'auto-post GL
« paid » qui vivait dans `invoices.service`/`customer-invoices.service` est **retiré** au profit du
post côté paiement (un seul `sourceType='payment'`) — éviter le double-post. Idempotence préservée.

## API REST (`apps/api/src/modules/billing`)

`PaymentsController` (`@RequireModule(BILLING)`), nouvelles permissions `billing.payments.read|manage`
(catalogue `packages/shared/src/permissions.ts`, règle 5 ; ramassées par le seed) :
- `GET    /billing/payments` — liste paginée (filtre type/status/party).
- `GET    /billing/payments/:id` — détail + allocations.
- `POST   /billing/payments` — crée un DRAFT (party, mode, date, devise, allocations).
- `PATCH  /billing/payments/:id` — édite un DRAFT (allocations).
- `POST   /billing/payments/:id/submit` — poste le GL + maj factures.
- `POST   /billing/payments/:id/cancel` — réécriture inverse.
- `GET    /billing/payments/open-invoices?partyType=&partyId=` — factures ouvertes (outstanding > 0)
  d'un tiers, pour l'écran d'allocation.

`ModesOfPaymentController` (CRUD léger, `billing.payments.manage`) :
- `GET/POST/PATCH/DELETE /billing/modes-of-payment`.

Tout tenant-scopé (règle 1), FK vérifiées (règle 9), n° via SequencesService (règle 8, clé `PAY`,
préfixe configurable `paymentNumberPrefix` défaut `'PAY'` dans `TenantModule.settings` billing — règle 36 ;
compteur indexé sur la clé, jamais le préfixe).

## UI Web (`apps/web/src/routes/(app)/billing`)

- `/billing/payments` — liste (n°, tiers, type, date, montant, statut) + KPI encours total ; filtres ;
  bouton « Nouvelle écriture de paiement ». Pattern existant (`$state` + `$effect` load, `api<T>()`,
  composants `$lib/components/ui`, toasts).
- Création (modale ou page) : choix type/tiers → fetch `open-invoices` → table d'allocation (montant
  par facture, total live, badge « entièrement alloué ») → mode de paiement, date, référence → submit.
- `/billing/payments/[id]` — détail + allocations + actions submit/cancel selon statut.
- Mode de paiement géré dans `/billing/config` (ou section dédiée) — master léger.
- Nav : entrée « Paiements » sous le domaine Finance/Billing de `navigation.ts`, gated
  `billing.payments.read`.

## Seed

- `ModeOfPayment` par défaut pour le tenant `acme` (upsert idempotent sur `(tenantId, name)`) :
  « Espèces » → `cashAccountCode`, « Banque » → `bankAccountCode`.
- Permissions `billing.payments.*` ramassées par le seed via le catalogue.

## Tests

- **Unitaire (`packages/shared`)** : `canTransitionPayment` (DRAFT→SUBMITTED→CANCELLED, refus des sauts
  illégaux).
- **e2e (`apps/api/test`)** : créer une customer invoice APPROVED → payer partiellement (outstanding
  décrémente, statut reste APPROVED) → payer le reste (statut PAID) → vérifier 2 écritures GL équilibrées
  `sourceType='payment'` + trial balance cohérente → cancel (réécriture inverse, facture revient
  APPROVED). Idem côté carrier invoice (PAY). Données master à codes uniques (réruns sûrs).
- Isolation tenant : un paiement d'un tenant n'alloue jamais une facture d'un autre (règle 1).

## Conformité aux hard rules

1 (tenant) · 2 (state machine `canTransitionPayment`) · 3 (enums miroir shared/schema) · 5 (permissions) ·
6 (audit) · 8 (SequencesService `PAY`) · 9 (OwnershipService sur party + cibles d'allocation) ·
36 (préfixe/comptes via settings billing) · 41 (GL double-entrée via `LedgerService.post`, équilibré,
idempotent, best-effort non requis ici car le post fait partie de la transaction de submit — un échec
de post **annule** le submit, contrairement à l'auto-post des transitions qui reste best-effort).

> Note règle 41 : ici le post GL est **transactionnel** avec le submit (le paiement n'est valide que
> si l'écriture passe), pas best-effort. C'est cohérent : l'auto-post best-effort concerne les
> transitions de facture (approve/pay automatiques) ; une Écriture de Paiement explicite DOIT produire
> son écriture ou échouer franchement.

## Préparation au futur (connecteurs)

Le modèle Payment + allocations + GL propre map directement sur un `Payment`/`BillPayment` QuickBooks
(et autres) — aucun travail spécifique maintenant, mais garder les montants signés et les comptes
explicites facilite l'export/connecteur futur (cf. vision plateforme ultra-connectée).
