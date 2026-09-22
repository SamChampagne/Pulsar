-- CreateTable
CREATE TABLE "catalog_stock_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "wmsItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_stock_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_part_usages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "wmsItemId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "binSnapshot" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operationKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "returnMovementId" TEXT,
    "returnOperationKey" TEXT,
    "returnFingerprint" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "returnedById" TEXT,

    CONSTRAINT "service_part_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_stock_links_tenantId_catalogItemId_key" ON "catalog_stock_links"("tenantId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_stock_links_tenantId_wmsItemId_key" ON "catalog_stock_links"("tenantId", "wmsItemId");

-- CreateIndex
CREATE INDEX "service_part_usages_tenantId_jobId_createdAt_idx" ON "service_part_usages"("tenantId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "service_part_usages_tenantId_wmsItemId_idx" ON "service_part_usages"("tenantId", "wmsItemId");

-- CreateIndex
CREATE UNIQUE INDEX "service_part_usages_tenantId_operationKey_key" ON "service_part_usages"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "service_part_usages_tenantId_returnOperationKey_key" ON "service_part_usages"("tenantId", "returnOperationKey");

-- CreateIndex
CREATE UNIQUE INDEX "service_part_usages_tenantId_movementId_key" ON "service_part_usages"("tenantId", "movementId");

-- CreateIndex
CREATE UNIQUE INDEX "service_part_usages_tenantId_returnMovementId_key" ON "service_part_usages"("tenantId", "returnMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "wms_bins_tenantId_id_key" ON "wms_bins"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wms_items_tenantId_id_key" ON "wms_items"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wms_stock_movements_tenantId_id_key" ON "wms_stock_movements"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "catalog_stock_links" ADD CONSTRAINT "catalog_stock_links_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_stock_links" ADD CONSTRAINT "catalog_stock_links_tenantId_wmsItemId_fkey" FOREIGN KEY ("tenantId", "wmsItemId") REFERENCES "wms_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "service_jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_wmsItemId_fkey" FOREIGN KEY ("tenantId", "wmsItemId") REFERENCES "wms_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_binId_fkey" FOREIGN KEY ("tenantId", "binId") REFERENCES "wms_bins"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_movementId_fkey" FOREIGN KEY ("tenantId", "movementId") REFERENCES "wms_stock_movements"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_usages_tenantId_returnMovementId_fkey" FOREIGN KEY ("tenantId", "returnMovementId") REFERENCES "wms_stock_movements"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_positive" CHECK ("quantity" > 0);
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_return_complete" CHECK (
  ("returnMovementId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL AND "returnedById" IS NULL AND "returnOperationKey" IS NULL AND "returnFingerprint" IS NULL)
  OR ("returnMovementId" IS NOT NULL AND "returnedAt" IS NOT NULL AND length(trim("returnReason")) > 0 AND "returnedById" IS NOT NULL AND "returnOperationKey" IS NOT NULL AND "returnFingerprint" IS NOT NULL)
);
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_author_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES users("tenantId", id);
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_return_author_fkey" FOREIGN KEY ("tenantId", "returnedById") REFERENCES users("tenantId", id);
