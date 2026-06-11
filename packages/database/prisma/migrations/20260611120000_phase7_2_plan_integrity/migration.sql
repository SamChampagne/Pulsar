-- Phase 7.2 plan integrity: time-window columns (RENAME, no data loss),
-- trailer pallet capacity, shipment_load_legs junction with backfill.

-- Time windows: RENAME (never drop/add — existing dates become the early bound).
ALTER TABLE "transport_orders" RENAME COLUMN "requestedPickupDate" TO "requestedPickupEarly";
ALTER TABLE "transport_orders" RENAME COLUMN "requestedDeliveryDate" TO "requestedDeliveryEarly";
ALTER TABLE "transport_orders" ADD COLUMN "requestedPickupLate" TIMESTAMP(3);
ALTER TABLE "transport_orders" ADD COLUMN "requestedDeliveryLate" TIMESTAMP(3);

ALTER TABLE "shipments" RENAME COLUMN "plannedPickupAt" TO "plannedPickupEarly";
ALTER TABLE "shipments" RENAME COLUMN "plannedDeliveryAt" TO "plannedDeliveryEarly";
ALTER TABLE "shipments" ADD COLUMN "plannedPickupLate" TIMESTAMP(3);
ALTER TABLE "shipments" ADD COLUMN "plannedDeliveryLate" TIMESTAMP(3);

ALTER TABLE "stops" RENAME COLUMN "plannedArrivalAt" TO "plannedArrivalEarly";
ALTER TABLE "stops" ADD COLUMN "plannedArrivalLate" TIMESTAMP(3);

-- Trailer pallet capacity.
ALTER TABLE "trailers" ADD COLUMN "capacityPallets" INTEGER;

-- CreateTable shipment_load_legs junction.
CREATE TABLE "shipment_load_legs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_load_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_load_legs_shipmentId_sequence_key" ON "shipment_load_legs"("shipmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_load_legs_shipmentId_loadId_key" ON "shipment_load_legs"("shipmentId", "loadId");

-- CreateIndex
CREATE INDEX "shipment_load_legs_tenantId_idx" ON "shipment_load_legs"("tenantId");

-- CreateIndex
CREATE INDEX "shipment_load_legs_loadId_idx" ON "shipment_load_legs"("loadId");

-- AddForeignKey
ALTER TABLE "shipment_load_legs" ADD CONSTRAINT "shipment_load_legs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_load_legs" ADD CONSTRAINT "shipment_load_legs_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_load_legs" ADD CONSTRAINT "shipment_load_legs_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one sequence-1 leg per currently assigned shipment.
INSERT INTO "shipment_load_legs" ("id", "tenantId", "shipmentId", "loadId", "sequence", "createdAt")
SELECT 'leg_' || md5(s."id" || ':' || s."loadId"), s."tenantId", s."id", s."loadId", 1, CURRENT_TIMESTAMP
FROM "shipments" s
WHERE s."loadId" IS NOT NULL;
