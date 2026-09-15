-- Nullable for legacy/manual movements; never deduplicate or delete historical data.
ALTER TABLE "bank_transactions" ADD COLUMN "importFingerprint" TEXT;
CREATE UNIQUE INDEX "bank_transactions_import_fingerprint_key"
  ON "bank_transactions"("tenantId", "bankAccountId", "importFingerprint");
CREATE INDEX "bank_transactions_tenantId_bankAccountId_date_idx"
  ON "bank_transactions"("tenantId", "bankAccountId", "date");
