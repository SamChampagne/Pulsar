-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'CONSUMPTION';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "material_purchase_orders" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "material_purchase_amendments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousDate" DATE NOT NULL,
    "expectedDate" DATE NOT NULL,
    "closedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_purchase_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_declarations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "goodQuantity" INTEGER NOT NULL,
    "scrapQuantity" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturing_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_purchase_amendments_tenantId_purchaseOrderId_creat_idx" ON "material_purchase_amendments"("tenantId", "purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "manufacturing_declarations_tenantId_orderId_createdAt_idx" ON "manufacturing_declarations"("tenantId", "orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_declarations_tenantId_operationKey_key" ON "manufacturing_declarations"("tenantId", "operationKey");

-- AddForeignKey
ALTER TABLE "material_purchase_amendments" ADD CONSTRAINT "material_purchase_amendments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "material_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_declarations" ADD CONSTRAINT "manufacturing_declarations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "material_purchase_orders" ADD CONSTRAINT "material_purchase_closed_quantity_check" CHECK ("closedQuantity" >= 0 AND (("closedAt" IS NULL AND "closedQuantity" = 0) OR ("closedAt" IS NOT NULL AND "closedQuantity" > 0)));
ALTER TABLE "material_purchase_amendments" ADD CONSTRAINT "material_purchase_amendment_kind_check" CHECK ("kind" IN ('RESCHEDULE', 'CLOSE_REMAINDER') AND length(trim("reason")) >= 3 AND "closedQuantity" >= 0);
ALTER TABLE "manufacturing_declarations" ADD CONSTRAINT "manufacturing_declaration_quantities_check" CHECK ("goodQuantity" >= 0 AND "scrapQuantity" >= 0 AND "goodQuantity" + "scrapQuantity" > 0);
