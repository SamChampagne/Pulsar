# Finance — Sous-projet #4 : Banque — Design

Date : 2026-06-25 · Module `billing` · Tier ERPNext post-fondamental.
Inspiration ERPNext : Banque, Compte bancaire, transactions bancaires, outil de réconciliation, relevé de rapprochement (Plaid reporté).
Décisions tranchées ici (autonomie totale).

## Objectif

Gérer des **comptes bancaires** et leurs **transactions** (saisie manuelle + import CSV), et **rapprocher** les lignes bancaires avec les paiements (sous-projet #1) qui ont frappé ce compte GL — un sous-livre de rapprochement, sans nouvelle écriture GL (le Payment a déjà posté).

## Périmètre v1 (décidé)

**Inclus :**
- `BankAccount` (master tenant-scopé) : nom, n° masqué, **`glAccountCode`** (lien vers un compte du plan, défaut `1010 Banque`), devise, isDefault.
- `BankTransaction` : date, description, **`amount` signé** (+ dépôt / − retrait), reference, `status BankTxnStatus` (UNRECONCILED/RECONCILED), `bankAccountId`, `matchedPaymentId?`. Source : création manuelle + **import CSV** (parse simple).
- **Solde** : solde courant d'un compte = Σ amount de ses transactions (calculé à la lecture).
- **Réconciliation** : matcher 1:1 une `BankTransaction` UNRECONCILED ↔ un `Payment` SUBMITTED non réconcilié dont le compte du mode de paiement = `BankAccount.glAccountCode` → marque les deux réconciliés (txn.status=RECONCILED + matchedPaymentId ; `Payment.reconciledAt`). Dé-matcher inverse.
- UI `/billing/banking` : comptes + transactions (+ import CSV) + écran de rapprochement.

**Reporté :** Plaid/feeds automatiques, rapprochement many-to-one, écritures GL depuis la banque (les frais bancaires etc. passent par les écritures manuelles existantes), relevé PDF.

## Modèle de données (Prisma)

```prisma
enum BankTxnStatus { UNRECONCILED  RECONCILED }

model BankAccount {
  id           String   @id @default(cuid())
  tenantId     String
  name         String
  accountNumber String?            // masqué à l'affichage (4 derniers)
  glAccountCode String   @default("1010")
  currency     String   @default("CAD")
  isDefault    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  transactions BankTransaction[]
  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("bank_accounts")
}

model BankTransaction {
  id              String        @id @default(cuid())
  tenantId        String
  bankAccountId   String
  date            DateTime
  description     String
  amount          Decimal       @db.Decimal(12, 2)   // signé
  reference       String?
  status          BankTxnStatus @default(UNRECONCILED)
  matchedPaymentId String?      @unique
  createdAt       DateTime      @default(now())
  bankAccount     BankAccount   @relation(fields: [bankAccountId], references: [id], onDelete: Cascade)
  @@index([tenantId, bankAccountId, status])
  @@map("bank_transactions")
}
```
+ `Payment.reconciledAt DateTime?` (sur le modèle Payment existant). + `Tenant.bankAccounts BankAccount[]`. Enum miroir shared↔Prisma.

## Helper pur (`packages/shared/src/billing/banking.ts`)

```ts
export interface CsvBankRow { date: string; description: string; amount: number; reference?: string }
/** Parse un CSV bancaire simple (entête date,description,amount[,reference]). Tolère ; ou ,. Ignore lignes vides. */
export function parseBankCsv(text: string): { rows: CsvBankRow[]; errors: string[] };
export function maskAccountNumber(n?: string | null): string;   // "•••• 1234"
export function bankBalance(amounts: number[]): number;          // round2 Σ
```

## API (`/billing/bank-accounts` + `/billing/bank-transactions`)

`BankAccountsController` (`@RequireModule(BILLING)`, **réutilise `PERMISSIONS.BILLING.LEDGER_READ|LEDGER_MANAGE`** — la banque relève du grand livre ; pas de nouvelle permission) :
- `GET/POST/PATCH/DELETE /billing/bank-accounts` (manage pour write), projection masque le n° complet.
- `GET /billing/bank-accounts/:id/balance` → `{ balance, txnCount }`.

`BankTransactionsController` :
- `GET /billing/bank-transactions?bankAccountId=&status=`
- `POST /billing/bank-transactions` (manuel) ; `POST /billing/bank-transactions/import` (`{ bankAccountId, csv }` → `parseBankCsv` → createMany ; renvoie {imported, errors}).
- `GET /billing/bank-transactions/reconciliation?bankAccountId=` → `{ unreconciledTransactions[], candidatePayments[] }` (paiements SUBMITTED, `reconciledAt=null`, dont le mode de paiement résout vers `glAccountCode` du compte).
- `POST /billing/bank-transactions/:id/match { paymentId }` → transaction (claim UNRECONCILED→RECONCILED) + `Payment.reconciledAt` dans la même transaction ; vérifie montants compatibles (avertissement si ≠, pas bloquant) ; audit.
- `POST /billing/bank-transactions/:id/unmatch` → inverse.

Tenant-scopé (règle 1), FK vérifiées (règle 9), audit sur match/unmatch (règle 6).

## UI Web

`/billing/banking` à onglets : **Comptes** (CRUD, n° masqué, solde) · **Transactions** (liste filtrée par compte/statut, création manuelle, import CSV) · **Rapprochement** (deux colonnes : transactions non réconciliées | paiements candidats ; bouton « Matcher » 1:1, « Dé-matcher »). Nav « Banque » sous Finance (`LEDGER_READ`). Number-coerce ; tones valides.

## Tests
- Unit shared : `parseBankCsv` (entête, `;`/`,`, lignes vides, montant invalide→errors), `maskAccountNumber`, `bankBalance`.
- e2e : créer un compte (glAccountCode 1010) ; import CSV 2 lignes ; solde = Σ ; créer+submit un Payment via le mode « Banque » ; reconciliation liste le paiement candidat ; match → txn RECONCILED + payment.reconciledAt ; unmatch inverse ; isolation tenant.

## Conformité hard rules
1 (tenant) · 2 (claim conditionnel UNRECONCILED→RECONCILED, TOCTOU) · 3 (enum miroir) · 5 (LEDGER_READ/MANAGE + @RequireModule) · 6 (audit match/unmatch) · 9 (FK bankAccount/payment). Helper CSV pur dans `@pulsar/shared`. **Pas d'écriture GL** depuis la banque (le rapprochement est un clearing du sous-livre ; le GL reste piloté par les Paiements — cohérent rule 41). `Payment.reconciledAt` ne change jamais le statut/`amountPaid` du paiement.

## Préparation futur
`BankAccount`+transactions+matching map sur les bank feeds QuickBooks/Plaid ; `parseBankCsv` remplaçable par un driver de feed.
