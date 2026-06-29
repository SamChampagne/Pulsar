# Finance — Sous-projet #7 : Abonnements (facturation récurrente) — Design

Date : 2026-06-25 · Module `billing`. Inspiration ERPNext : Plan d'abonnement, Abonnement, génération récurrente de factures.
Décisions tranchées ici (autonomie totale).

## Objectif
Définir des **abonnements** (client + lignes + intervalle) qui **génèrent des relevés client (`CustomerInvoice`) DRAFT** à chaque période, de façon **idempotente**, en réutilisant les lignes libres de CustomerInvoice (socle cycle 7). Pas d'écriture GL directe — la facture générée suit le flux billing existant (approve → GL).

## Périmètre v1 (décidé)
**Inclus :**
- `Subscription` (tenant-scopé) : `name`, `customerId`, `status SubscriptionStatus` (ACTIVE/PAUSED/CANCELLED), `interval SubscriptionInterval` (WEEKLY/MONTHLY/YEARLY), `startDate`, `nextRunDate`, `currency`, lignes.
- `SubscriptionLine` : `description`, `amount` (Decimal). (Pas de lien produit v1 — lignes libres.)
- `SubscriptionInvoice` : `subscriptionId`, `periodStart`, `customerInvoiceId`, `@@unique([tenantId, subscriptionId, periodStart])` → **idempotence** de génération + traçabilité.
- **Génération** : pour une période due, créer une `CustomerInvoice` DRAFT (n° via `SequencesService`, total = Σ lignes) avec des `CustomerInvoiceLine` libres (transportOrderId null, description/amount/source='subscription'), enregistrer `SubscriptionInvoice` (idempotent), avancer `nextRunDate` de l'intervalle.
- **Endpoints** : `POST :id/generate` (génère la période courante due) + `POST /billing/subscriptions/run-due` (itère les ACTIVE avec `nextRunDate <= today`, best-effort, renvoie le compte généré/sauté).
- **Statut** : `canTransitionSubscription` — ACTIVE↔PAUSED, ACTIVE/PAUSED→CANCELLED. Ne génère que si ACTIVE.
- UI `/billing/subscriptions`.

**Reporté :** plans d'abonnement réutilisables, lignes liées aux produits CRM, cron automatique (run-due est manuel/déclenchable), prorata, taxes auto.

## Modèle de données (Prisma)
```prisma
enum SubscriptionStatus { ACTIVE  PAUSED  CANCELLED }
enum SubscriptionInterval { WEEKLY  MONTHLY  YEARLY }

model Subscription {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  customerId  String
  status      SubscriptionStatus   @default(ACTIVE)
  interval    SubscriptionInterval @default(MONTHLY)
  startDate   DateTime
  nextRunDate DateTime
  currency    String   @default("CAD")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  customer    Customer @relation(fields: [customerId], references: [id])
  lines       SubscriptionLine[]
  generated   SubscriptionInvoice[]
  @@index([tenantId, status, nextRunDate])
  @@map("subscriptions")
}
model SubscriptionLine {
  id             String  @id @default(cuid())
  tenantId       String
  subscriptionId String
  description    String
  amount         Decimal @db.Decimal(12, 2)
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  @@index([tenantId, subscriptionId])
  @@map("subscription_lines")
}
model SubscriptionInvoice {
  id                String   @id @default(cuid())
  tenantId          String
  subscriptionId    String
  periodStart       DateTime
  customerInvoiceId String
  createdAt         DateTime @default(now())
  subscription      Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  @@unique([tenantId, subscriptionId, periodStart])
  @@index([tenantId, subscriptionId])
  @@map("subscription_invoices")
}
```
+ `Tenant.subscriptions Subscription[]` + `Customer.subscriptions Subscription[]`. Enums miroir.

## Helpers purs + state machine (`packages/shared/src/billing/subscription.ts`)
```ts
export enum SubscriptionStatus { ACTIVE='ACTIVE', PAUSED='PAUSED', CANCELLED='CANCELLED' }
export enum SubscriptionInterval { WEEKLY='WEEKLY', MONTHLY='MONTHLY', YEARLY='YEARLY' }
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  ACTIVE: [PAUSED, CANCELLED], PAUSED: [ACTIVE, CANCELLED], CANCELLED: [],
};
export function canTransitionSubscription(from, to): boolean;
/** Avance une date UTC d'un intervalle (WEEKLY +7j, MONTHLY +1 mois, YEARLY +1 an). Pur — date passée en argument (pas de Date.now). */
export function advanceRunDate(current: Date, interval: SubscriptionInterval): Date;
```

## API (`/billing/subscriptions`)
`SubscriptionsController` (`@RequireModule(BILLING)`, nouvelles permissions `billing.subscriptions.read|manage`) :
- `GET/POST/PATCH/DELETE /billing/subscriptions` (lignes incluses ; PATCH remplace les lignes ; DELETE interdit si des factures ont été générées → 409, sinon cascade).
- `POST :id/pause` / `:id/resume` / `:id/cancel` (transitions via `canTransitionSubscription` + claim updateMany).
- `POST :id/generate` : abonnement ACTIVE ; `periodStart = startOfPeriod(nextRunDate)` ; **transaction** : créer `CustomerInvoice` DRAFT (Sequences, total Σ lignes) + `CustomerInvoiceLine` libres + `SubscriptionInvoice` (P2002 (tenant,sub,periodStart) → 409 « déjà généré ») + avancer `nextRunDate = advanceRunDate(nextRunDate, interval)`. Audit. Renvoie la facture créée.
- `POST /billing/subscriptions/run-due` : itère les ACTIVE `nextRunDate <= now`, appelle `generate` chacun en best-effort (un échec n'arrête pas les autres) ; renvoie `{ generated, skipped, errors }`.

`SubscriptionsService` : CRUD tenant-scopé ; transitions via state machine + claim. Pas d'écriture GL (la facture générée passe par le flux billing). Tenant isolation (règle 1), FK customer vérifiée (règle 9), n° via `SequencesService` (règle 8 — réutilise la clé `customer-invoice`).

## UI Web
`/billing/subscriptions` : liste (nom, client, intervalle, statut badge, prochaine échéance, total/période) ; create/edit modal (client, intervalle, startDate, lignes répétables) ; actions pause/resume/cancel + « Générer maintenant » + bouton global « Générer les abonnements dus » (run-due) ; lien vers les relevés générés. Nav « Abonnements » sous Finance (`billing.subscriptions.read`). Number-coerce ; tones valides ; **aligner DTO + grep**.

## Tests
- Unit shared : `advanceRunDate` (WEEKLY/MONTHLY/YEARLY, bord de mois), `canTransitionSubscription`.
- e2e : créer un abonnement MONTHLY (client, 1 ligne 50) ; `generate` → CustomerInvoice DRAFT total 50 + SubscriptionInvoice + nextRunDate +1 mois ; re-generate même période → 409 ; run-due ; pause→generate refusé ; cancel ; isolation tenant.

## Conformité hard rules
1 (tenant) · 2 (`canTransitionSubscription` + claim) · 3 (enums miroir) · 5 (`billing.subscriptions.read|manage` + `@RequireModule(BILLING)`) · 6 (audit transitions + generate) · 8 (Sequences `customer-invoice`) · 9 (FK customer). Helpers purs `@pulsar/shared`. **Génération idempotente** sur `(tenantId, subscriptionId, periodStart)`. Pas d'écriture GL directe (la facture suit le flux billing existant). `run-due` best-effort (un abonnement en échec n'affecte pas les autres) — jamais de throw global.

## Préparation futur
`Subscription`+lignes map sur les Recurring Transactions QuickBooks ; `run-due` = point d'attache d'un cron futur.
