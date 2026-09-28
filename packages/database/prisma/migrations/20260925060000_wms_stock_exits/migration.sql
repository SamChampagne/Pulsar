ALTER TYPE "StockMovementType" ADD VALUE 'DISPOSAL';
ALTER TYPE "StockMovementType" ADD VALUE 'SUPPLIER_RETURN';
CREATE TYPE "StockExitKind" AS ENUM ('DISPOSAL','SUPPLIER_RETURN');
CREATE TYPE "StockExitStatus" AS ENUM ('DRAFT','POSTED','CANCELLED');
CREATE TABLE "wms_stock_exits" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "number" TEXT NOT NULL,
 "kind" "StockExitKind" NOT NULL, "status" "StockExitStatus" NOT NULL DEFAULT 'DRAFT',
 "itemId" TEXT NOT NULL, "lotId" TEXT NOT NULL, "binId" TEXT NOT NULL,
 "quantity" DECIMAL(14,3) NOT NULL, "unitSnapshot" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "supplierId" TEXT, "reference" TEXT, "destination" TEXT, "snapshot" JSONB NOT NULL, "evidence" JSONB,
 "operationKey" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL,
 "resolutionKey" TEXT, "resolutionFingerprint" TEXT, "completionNote" TEXT, "cancellationReason" TEXT,
 "movementId" TEXT, "createdById" TEXT NOT NULL, "closedById" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "closedAt" TIMESTAMP(3),
 CONSTRAINT "wms_stock_exits_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "wms_stock_exits_quantity_check" CHECK ("quantity">0 AND "quantity"<=999999999.999 AND length(btrim("reason"))>=3),
 CONSTRAINT "wms_stock_exits_kind_check" CHECK (
   ("kind"='DISPOSAL' AND "supplierId" IS NULL AND "reference" IS NULL AND "destination" IS NULL) OR
   ("kind"='SUPPLIER_RETURN' AND "supplierId" IS NOT NULL AND "reference" IS NOT NULL AND "destination" IS NOT NULL AND length(btrim("reference"))>=3 AND length(btrim("destination"))>=10)),
 CONSTRAINT "wms_stock_exits_state_check" CHECK (
   ("status"='DRAFT' AND "closedAt" IS NULL AND "closedById" IS NULL AND "movementId" IS NULL AND "evidence" IS NULL AND "resolutionKey" IS NULL AND "resolutionFingerprint" IS NULL AND "completionNote" IS NULL AND "cancellationReason" IS NULL) OR
   ("status"='POSTED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "movementId" IS NOT NULL AND "evidence" IS NOT NULL AND "resolutionKey" IS NOT NULL AND "resolutionFingerprint" IS NOT NULL AND "completionNote" IS NOT NULL AND length(btrim("completionNote"))>=10 AND "cancellationReason" IS NULL) OR
   ("status"='CANCELLED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "movementId" IS NULL AND "evidence" IS NULL AND "resolutionKey" IS NOT NULL AND "resolutionFingerprint" IS NOT NULL AND "completionNote" IS NULL AND "cancellationReason" IS NOT NULL AND length(btrim("cancellationReason"))>=3))
);
CREATE UNIQUE INDEX "wms_stock_exits_tenantId_id_key" ON "wms_stock_exits"("tenantId","id");
CREATE UNIQUE INDEX "wms_stock_exits_tenantId_number_key" ON "wms_stock_exits"("tenantId","number");
CREATE UNIQUE INDEX "wms_stock_exits_tenantId_operationKey_key" ON "wms_stock_exits"("tenantId","operationKey");
CREATE UNIQUE INDEX "wms_stock_exits_tenantId_resolutionKey_key" ON "wms_stock_exits"("tenantId","resolutionKey");
CREATE UNIQUE INDEX "wms_stock_exits_tenantId_movementId_key" ON "wms_stock_exits"("tenantId","movementId");
CREATE INDEX "wms_stock_exits_tenantId_lotId_createdAt_idx" ON "wms_stock_exits"("tenantId","lotId","createdAt");
CREATE INDEX "wms_stock_exits_tenantId_status_createdAt_idx" ON "wms_stock_exits"("tenantId","status","createdAt");
ALTER TABLE "wms_stock_exits"
 ADD CONSTRAINT "wms_stock_exits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_itemId_fkey" FOREIGN KEY ("tenantId","itemId") REFERENCES "wms_items"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_itemId_lotId_fkey" FOREIGN KEY ("tenantId","itemId","lotId") REFERENCES "wms_lots"("tenantId","itemId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_binId_fkey" FOREIGN KEY ("tenantId","binId") REFERENCES "wms_bins"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId","supplierId") REFERENCES "business_partners"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_createdById_fkey" FOREIGN KEY ("tenantId","createdById") REFERENCES "users"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_closedById_fkey" FOREIGN KEY ("tenantId","closedById") REFERENCES "users"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_stock_exits_tenantId_movementId_fkey" FOREIGN KEY ("tenantId","movementId") REFERENCES "wms_stock_movements"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Even another internal caller cannot post a second physical exit for the same dossier.
CREATE UNIQUE INDEX "wms_stock_exit_one_movement" ON "wms_stock_movements"("tenantId","refId") WHERE "refType"='stock-exit';
