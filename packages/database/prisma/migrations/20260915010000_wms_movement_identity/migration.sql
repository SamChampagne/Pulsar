-- Additive: historical movements retain NULL identities and units (no invented backfill).
ALTER TABLE "wms_stock_movements"
  ADD COLUMN "operationKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "unitSnapshot" TEXT;
CREATE UNIQUE INDEX "wms_stock_movements_tenantId_operationKey_key"
  ON "wms_stock_movements"("tenantId", "operationKey");
CREATE INDEX "wms_stock_movements_tenantId_fromBinId_createdAt_idx"
  ON "wms_stock_movements"("tenantId", "fromBinId", "createdAt");
CREATE INDEX "wms_stock_movements_tenantId_toBinId_createdAt_idx"
  ON "wms_stock_movements"("tenantId", "toBinId", "createdAt");
