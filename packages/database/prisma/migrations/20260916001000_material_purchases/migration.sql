-- CreateEnum
CREATE TYPE "MaterialPurchaseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "material_suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "terms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "MaterialPurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierSnapshot" JSONB NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "expectedDate" DATE NOT NULL,
    "terms" TEXT,
    "supplierReference" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_purchase_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_suppliers_tenantId_isActive_idx" ON "material_suppliers"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "material_suppliers_tenantId_code_key" ON "material_suppliers"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchase_orders_preparationId_key" ON "material_purchase_orders"("preparationId");

-- CreateIndex
CREATE INDEX "material_purchase_orders_tenantId_status_expectedDate_idx" ON "material_purchase_orders"("tenantId", "status", "expectedDate");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchase_orders_tenantId_number_key" ON "material_purchase_orders"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchase_orders_tenantId_operationKey_key" ON "material_purchase_orders"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchase_receipts_receiptId_key" ON "material_purchase_receipts"("receiptId");

-- CreateIndex
CREATE INDEX "material_purchase_receipts_tenantId_purchaseOrderId_idx" ON "material_purchase_receipts"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchase_receipts_tenantId_operationKey_key" ON "material_purchase_receipts"("tenantId", "operationKey");

-- AddForeignKey
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_orders" ADD CONSTRAINT "material_purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_orders" ADD CONSTRAINT "material_purchase_orders_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "mrp_preparations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_orders" ADD CONSTRAINT "material_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "material_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_receipts" ADD CONSTRAINT "material_purchase_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_receipts" ADD CONSTRAINT "material_purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "material_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_receipts" ADD CONSTRAINT "material_purchase_receipts_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "wms_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "material_purchase_orders" ADD CONSTRAINT "material_purchase_price_check" CHECK ("unitPrice" >= 0 AND "unitPrice" <= 1000000000), ADD CONSTRAINT "material_purchase_currency_check" CHECK ("currency" IN ('CAD', 'USD', 'EUR')), ADD CONSTRAINT "material_purchase_confirmation_check" CHECK (status <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND length(trim("supplierReference")) > 0));

