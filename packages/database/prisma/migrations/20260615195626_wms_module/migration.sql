-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'MOVE', 'PICK', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BinKind" AS ENUM ('RECEIVING', 'STORAGE', 'SHIPPING');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickOrderStatus" AS ENUM ('OPEN', 'PICKED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "wms_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_bins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "BinKind" NOT NULL DEFAULT 'STORAGE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_inventory_levels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "qtyOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromBinId" TEXT,
    "toBinId" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wms_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT,
    "note" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_receipt_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "toBinId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "wms_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_pick_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "PickOrderStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_pick_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_pick_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pickOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromBinId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "wms_pick_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wms_items_tenantId_idx" ON "wms_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "wms_items_tenantId_sku_key" ON "wms_items"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "wms_bins_tenantId_locationId_idx" ON "wms_bins"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "wms_bins_tenantId_locationId_code_key" ON "wms_bins"("tenantId", "locationId", "code");

-- CreateIndex
CREATE INDEX "wms_inventory_levels_tenantId_itemId_idx" ON "wms_inventory_levels"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "wms_inventory_levels_tenantId_binId_idx" ON "wms_inventory_levels"("tenantId", "binId");

-- CreateIndex
CREATE UNIQUE INDEX "wms_inventory_levels_tenantId_itemId_binId_key" ON "wms_inventory_levels"("tenantId", "itemId", "binId");

-- CreateIndex
CREATE INDEX "wms_stock_movements_tenantId_itemId_idx" ON "wms_stock_movements"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "wms_stock_movements_tenantId_createdAt_idx" ON "wms_stock_movements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "wms_stock_movements_tenantId_refType_refId_idx" ON "wms_stock_movements"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "wms_receipts_tenantId_status_idx" ON "wms_receipts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wms_receipts_tenantId_number_key" ON "wms_receipts"("tenantId", "number");

-- CreateIndex
CREATE INDEX "wms_receipt_lines_tenantId_receiptId_idx" ON "wms_receipt_lines"("tenantId", "receiptId");

-- CreateIndex
CREATE INDEX "wms_pick_orders_tenantId_status_idx" ON "wms_pick_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wms_pick_orders_tenantId_number_key" ON "wms_pick_orders"("tenantId", "number");

-- CreateIndex
CREATE INDEX "wms_pick_lines_tenantId_pickOrderId_idx" ON "wms_pick_lines"("tenantId", "pickOrderId");

-- AddForeignKey
ALTER TABLE "wms_items" ADD CONSTRAINT "wms_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_inventory_levels" ADD CONSTRAINT "wms_inventory_levels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_inventory_levels" ADD CONSTRAINT "wms_inventory_levels_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_inventory_levels" ADD CONSTRAINT "wms_inventory_levels_binId_fkey" FOREIGN KEY ("binId") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_movements" ADD CONSTRAINT "wms_stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_movements" ADD CONSTRAINT "wms_stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_movements" ADD CONSTRAINT "wms_stock_movements_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "wms_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_movements" ADD CONSTRAINT "wms_stock_movements_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "wms_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_receipts" ADD CONSTRAINT "wms_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_receipts" ADD CONSTRAINT "wms_receipts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_receipt_lines" ADD CONSTRAINT "wms_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "wms_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_receipt_lines" ADD CONSTRAINT "wms_receipt_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_receipt_lines" ADD CONSTRAINT "wms_receipt_lines_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_pick_orders" ADD CONSTRAINT "wms_pick_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_pick_orders" ADD CONSTRAINT "wms_pick_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_pick_lines" ADD CONSTRAINT "wms_pick_lines_pickOrderId_fkey" FOREIGN KEY ("pickOrderId") REFERENCES "wms_pick_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_pick_lines" ADD CONSTRAINT "wms_pick_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_pick_lines" ADD CONSTRAINT "wms_pick_lines_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
