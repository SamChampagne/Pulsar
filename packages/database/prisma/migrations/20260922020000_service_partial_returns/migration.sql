ALTER TABLE "service_part_usages"
  ADD COLUMN "returnedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve pending source versions and the exact quantities of known historical returns.
UPDATE "service_part_usages"
SET "returnedQuantity" = CASE WHEN "returnMovementId" IS NOT NULL THEN "quantity" ELSE 0 END,
    "updatedAt" = COALESCE("returnedAt", "createdAt");

ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_returned_bounds"
  CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");
CREATE UNIQUE INDEX "service_part_usages_tenantId_id_key" ON "service_part_usages"("tenantId", "id");

CREATE TABLE "service_part_returns" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "usageId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  CONSTRAINT "service_part_return_positive" CHECK ("quantity" > 0),
  CONSTRAINT "service_part_return_reason" CHECK (length(trim("reason")) > 0)
);
CREATE UNIQUE INDEX "service_part_returns_tenantId_operationKey_key" ON "service_part_returns"("tenantId", "operationKey");
CREATE UNIQUE INDEX "service_part_returns_tenantId_movementId_key" ON "service_part_returns"("tenantId", "movementId");
CREATE INDEX "service_part_returns_tenantId_usageId_createdAt_idx" ON "service_part_returns"("tenantId", "usageId", "createdAt");
ALTER TABLE "service_part_returns" ADD CONSTRAINT "service_part_returns_tenantId_usageId_fkey"
  FOREIGN KEY ("tenantId", "usageId") REFERENCES "service_part_usages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_part_returns" ADD CONSTRAINT "service_part_returns_tenantId_createdById_fkey"
  FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "service_part_returns" ADD CONSTRAINT "service_part_returns_tenantId_movementId_fkey"
  FOREIGN KEY ("tenantId", "movementId") REFERENCES "wms_stock_movements"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reuse actual movements, authors, timestamps and fingerprints: no stock is posted by migration.
-- The v1 fingerprint remains replayable by a browser with a pending full-return request.
INSERT INTO "service_part_returns" ("id", "tenantId", "usageId", "quantity", "reason", "createdAt", "createdById", "operationKey", "requestFingerprint", "movementId")
SELECT 'legacy:' || "id", "tenantId", "id", "quantity", "returnReason", "returnedAt", "returnedById", "returnOperationKey", "returnFingerprint", "returnMovementId"
FROM "service_part_usages" WHERE "returnMovementId" IS NOT NULL;
