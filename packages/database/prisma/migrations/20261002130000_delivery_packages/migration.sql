-- Additive and opt-in: historical shipments are not assumed to have physical package tracking.
CREATE TYPE "DeliveryPackageStatus" AS ENUM ('PREPARED', 'LOADED', 'DELIVERED', 'CANCELLED');

ALTER TABLE "shipments" ADD COLUMN "packageTrackingEnabledAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "shipments_tenantId_id_key" ON "shipments"("tenantId", "id");
CREATE UNIQUE INDEX "loads_tenantId_id_key" ON "loads"("tenantId", "id");

CREATE TABLE "delivery_packages" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "status" "DeliveryPackageStatus" NOT NULL DEFAULT 'PREPARED',
  "contents" JSONB NOT NULL,
  "loadedLoadId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "loadedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_packages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_packages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_packages_tenantId_shipmentId_fkey" FOREIGN KEY ("tenantId", "shipmentId") REFERENCES "shipments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_packages_tenantId_loadedLoadId_fkey" FOREIGN KEY ("tenantId", "loadedLoadId") REFERENCES "loads"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_packages_version_check" CHECK ("version" > 0),
  CONSTRAINT "delivery_packages_code_check" CHECK (length("code") BETWEEN 1 AND 80),
  CONSTRAINT "delivery_packages_contents_check" CHECK (
    CASE WHEN jsonb_typeof("contents") = 'array' THEN jsonb_array_length("contents") BETWEEN 1 AND 50 ELSE false END
  ),
  CONSTRAINT "delivery_packages_execution_check" CHECK (
    ("status" IN ('PREPARED', 'CANCELLED') AND "loadedLoadId" IS NULL AND "loadedAt" IS NULL AND "deliveredAt" IS NULL)
    OR ("status" = 'LOADED' AND "loadedLoadId" IS NOT NULL AND "loadedAt" IS NOT NULL AND "deliveredAt" IS NULL)
    OR ("status" = 'DELIVERED' AND "loadedLoadId" IS NOT NULL AND "loadedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "deliveredAt" >= "loadedAt")
  )
);
CREATE UNIQUE INDEX "delivery_packages_tenantId_id_key" ON "delivery_packages"("tenantId", "id");
CREATE UNIQUE INDEX "delivery_packages_tenantId_code_key" ON "delivery_packages"("tenantId", "code");
CREATE INDEX "delivery_packages_tenantId_shipmentId_status_idx" ON "delivery_packages"("tenantId", "shipmentId", "status");
CREATE INDEX "delivery_packages_tenantId_loadedLoadId_status_idx" ON "delivery_packages"("tenantId", "loadedLoadId", "status");

CREATE TABLE "delivery_package_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "operationKey" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_package_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_package_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_package_events_tenantId_packageId_fkey" FOREIGN KEY ("tenantId", "packageId") REFERENCES "delivery_packages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_package_events_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "delivery_package_events_actor_check" CHECK (length("actorId") > 0),
  CONSTRAINT "delivery_package_events_fingerprint_check" CHECK (length("fingerprint") > 0)
);
CREATE UNIQUE INDEX "delivery_package_events_tenantId_operationKey_key" ON "delivery_package_events"("tenantId", "operationKey");
CREATE INDEX "delivery_package_events_tenantId_packageId_createdAt_idx" ON "delivery_package_events"("tenantId", "packageId", "createdAt");
