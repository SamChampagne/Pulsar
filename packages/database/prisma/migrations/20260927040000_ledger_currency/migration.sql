ALTER TABLE "journal_entries" ADD COLUMN "currency" TEXT, ADD COLUMN "fingerprint" TEXT;
CREATE INDEX "journal_entries_tenantId_currency_date_idx" ON "journal_entries"("tenantId","currency","date");
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currency_supported" CHECK ("currency" IS NULL OR "currency" IN ('CAD','USD','EUR','MXN','GBP'));
-- Deliberately no backfill: current source/default currency cannot reconstruct historical evidence.
