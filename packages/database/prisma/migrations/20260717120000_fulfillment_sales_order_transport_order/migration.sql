-- Fulfillment bridge: link CRM sales orders to TMS transport orders.
-- Ordinary transport orders keep both columns NULL and are unaffected by the
-- compound unique (NULLs are distinct in Postgres). The unique makes CRM-origin
-- creation idempotent on (tenantId, sourceSalesOrderId, sourceFulfillmentKey).

-- AlterTable
ALTER TABLE "transport_orders" ADD COLUMN     "sourceFulfillmentKey" TEXT,
ADD COLUMN     "sourceSalesOrderId" TEXT;

-- CreateIndex
CREATE INDEX "transport_orders_tenantId_sourceSalesOrderId_idx" ON "transport_orders"("tenantId", "sourceSalesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "transport_orders_tenantId_sourceSalesOrderId_sourceFulfillm_key" ON "transport_orders"("tenantId", "sourceSalesOrderId", "sourceFulfillmentKey");

-- AddForeignKey
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_sourceSalesOrderId_fkey" FOREIGN KEY ("sourceSalesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
