ALTER TABLE "ledger_currency_qualifications" ADD COLUMN "sourceEntryId" TEXT;
CREATE INDEX "ledger_currency_qualifications_tenantId_sourceEntryId_idx"
  ON "ledger_currency_qualifications"("tenantId", "sourceEntryId");
ALTER TABLE "ledger_currency_qualifications" ADD CONSTRAINT "ledger_currency_qualifications_sourceEntryId_fkey"
  FOREIGN KEY ("tenantId", "sourceEntryId") REFERENCES "journal_entries"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
