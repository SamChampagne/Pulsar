-- AlterTable
ALTER TABLE "wms_pick_orders" ADD COLUMN     "shipmentId" TEXT;

-- CreateIndex
CREATE INDEX "wms_pick_orders_tenantId_shipmentId_idx" ON "wms_pick_orders"("tenantId", "shipmentId");

-- AddForeignKey
ALTER TABLE "wms_pick_orders" ADD CONSTRAINT "wms_pick_orders_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
