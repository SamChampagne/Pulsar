CREATE TYPE "LedgerCurrencyState" AS ENUM ('QUALIFIED','WITHDRAWN');
CREATE TABLE ledger_currency_qualifications (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "entryId" TEXT NOT NULL,
 state "LedgerCurrencyState" NOT NULL, currency VARCHAR(3), version INTEGER NOT NULL CHECK(version>0), "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ledger_currency_qualifications_tenantId_entryId_fkey" FOREIGN KEY("tenantId","entryId") REFERENCES journal_entries("tenantId",id) ON DELETE RESTRICT,
 CHECK((state='QUALIFIED' AND currency IS NOT NULL AND currency IN ('CAD','USD','EUR','MXN','GBP')) OR (state='WITHDRAWN' AND currency IS NULL))
);
CREATE UNIQUE INDEX "ledger_currency_qualifications_tenantId_entryId_key" ON ledger_currency_qualifications("tenantId","entryId");
CREATE INDEX "ledger_currency_qualifications_tenantId_state_currency_idx" ON ledger_currency_qualifications("tenantId",state,currency);
CREATE TABLE ledger_currency_evidence (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "entryId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
 caption TEXT NOT NULL, sha256 TEXT NOT NULL, "operationKey" UUID NOT NULL, fingerprint TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ledger_currency_evidence_tenantId_entryId_fkey" FOREIGN KEY("tenantId","entryId") REFERENCES journal_entries("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "ledger_currency_evidence_tenantId_documentId_fkey" FOREIGN KEY("tenantId","documentId") REFERENCES documents("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ledger_currency_evidence_tenantId_entryId_id_key" ON ledger_currency_evidence("tenantId","entryId",id);
CREATE UNIQUE INDEX "ledger_currency_evidence_tenantId_documentId_key" ON ledger_currency_evidence("tenantId","documentId");
CREATE UNIQUE INDEX "ledger_currency_evidence_tenantId_operationKey_key" ON ledger_currency_evidence("tenantId","operationKey");
CREATE TABLE ledger_currency_revisions (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "entryId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "evidenceId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), "operationKey" UUID NOT NULL, fingerprint TEXT NOT NULL, snapshot JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ledger_currency_revisions_tenantId_entryId_fkey" FOREIGN KEY("tenantId","entryId") REFERENCES journal_entries("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "ledger_currency_revisions_tenantId_actorId_fkey" FOREIGN KEY("tenantId","actorId") REFERENCES users("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "ledger_currency_revisions_tenantId_entryId_evidenceId_fkey" FOREIGN KEY("tenantId","entryId","evidenceId") REFERENCES ledger_currency_evidence("tenantId","entryId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ledger_currency_revisions_tenantId_operationKey_key" ON ledger_currency_revisions("tenantId","operationKey");
CREATE UNIQUE INDEX "ledger_currency_revisions_tenantId_entryId_version_key" ON ledger_currency_revisions("tenantId","entryId",version);
