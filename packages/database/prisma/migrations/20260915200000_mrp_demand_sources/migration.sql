ALTER TYPE "MrpEntryKind" ADD VALUE 'FORECAST';
ALTER TABLE "mrp_entries"
  ADD COLUMN "forecastStart" DATE,
  ADD COLUMN "forecastId" TEXT REFERENCES "mrp_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "sourceSalesOrderLineId" TEXT REFERENCES "sales_order_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "sourceSnapshot" JSONB;
CREATE UNIQUE INDEX "mrp_entries_tenantId_sourceSalesOrderLineId_key" ON "mrp_entries"("tenantId", "sourceSalesOrderLineId");
CREATE INDEX "mrp_entries_tenantId_forecastId_idx" ON "mrp_entries"("tenantId", "forecastId");
-- Existing manual demands remain independent; no automatic conversion or matching.
