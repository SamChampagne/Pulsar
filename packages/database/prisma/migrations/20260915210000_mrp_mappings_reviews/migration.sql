CREATE TABLE "mrp_product_mappings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "crm_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "commercialUnit" TEXT NOT NULL,
  "numerator" DECIMAL(18,6) NOT NULL CHECK ("numerator" > 0),
  "denominator" DECIMAL(18,6) NOT NULL CHECK ("denominator" > 0),
  "unitSnapshot" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "mrp_product_mappings_tenantId_productId_key" ON "mrp_product_mappings"("tenantId", "productId");
CREATE INDEX "mrp_product_mappings_tenantId_itemId_idx" ON "mrp_product_mappings"("tenantId", "itemId");
CREATE TABLE "mrp_reviews" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "runId" TEXT NOT NULL REFERENCES "mrp_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "taskId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "itemIds" JSONB NOT NULL,
  "staleAtReview" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mrp_reviews_tenantId_contentHash_key" ON "mrp_reviews"("tenantId", "contentHash");
CREATE INDEX "mrp_reviews_tenantId_runId_createdAt_idx" ON "mrp_reviews"("tenantId", "runId", "createdAt");
-- Existing demand snapshots remain unchanged. No implicit conversion or agent activation.
