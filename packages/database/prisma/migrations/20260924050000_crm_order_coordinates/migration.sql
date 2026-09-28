-- Additive: no identity merge, copied contact or historical document backfill.
ALTER TABLE "party_directory_entries" ADD COLUMN "companyId" TEXT;
ALTER TABLE "party_directory_entries" DROP CONSTRAINT "party_directory_one_owner";
ALTER TABLE "party_directory_entries" ADD CONSTRAINT "party_directory_one_owner"
  CHECK (num_nonnulls("customerId", "partnerId", "companyId") = 1);
ALTER TABLE "party_directory_entries" ADD CONSTRAINT "party_directory_company_fkey"
  FOREIGN KEY ("tenantId", "companyId") REFERENCES "crm_companies"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "party_directory_entries_tenantId_companyId_kind_idx"
  ON "party_directory_entries"("tenantId", "companyId", "kind");
ALTER TABLE "sales_orders" ADD COLUMN "documentCoordinates" JSONB;
