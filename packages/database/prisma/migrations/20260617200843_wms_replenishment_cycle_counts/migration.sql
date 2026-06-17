-- CreateEnum
CREATE TYPE "CycleCountStatus" AS ENUM ('OPEN', 'COUNTED', 'RECONCILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "wms_items" ADD COLUMN     "reorderPoint" INTEGER,
ADD COLUMN     "reorderQty" INTEGER;

-- CreateTable
CREATE TABLE "wms_cycle_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "status" "CycleCountStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "countedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wms_cycle_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_cycle_count_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wms_cycle_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wms_cycle_counts_tenantId_status_idx" ON "wms_cycle_counts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "wms_cycle_counts_tenantId_binId_idx" ON "wms_cycle_counts"("tenantId", "binId");

-- CreateIndex
CREATE UNIQUE INDEX "wms_cycle_counts_tenantId_number_key" ON "wms_cycle_counts"("tenantId", "number");

-- CreateIndex
CREATE INDEX "wms_cycle_count_lines_tenantId_cycleCountId_idx" ON "wms_cycle_count_lines"("tenantId", "cycleCountId");

-- AddForeignKey
ALTER TABLE "wms_cycle_counts" ADD CONSTRAINT "wms_cycle_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_cycle_counts" ADD CONSTRAINT "wms_cycle_counts_binId_fkey" FOREIGN KEY ("binId") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_cycle_count_lines" ADD CONSTRAINT "wms_cycle_count_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_cycle_count_lines" ADD CONSTRAINT "wms_cycle_count_lines_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "wms_cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_cycle_count_lines" ADD CONSTRAINT "wms_cycle_count_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

