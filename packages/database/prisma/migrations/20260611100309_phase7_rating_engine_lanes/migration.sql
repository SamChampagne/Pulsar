-- CreateEnum
CREATE TYPE "LaneEndpointType" AS ENUM ('LOCATION', 'CITY', 'STATE', 'COUNTRY');

-- CreateEnum
CREATE TYPE "AccessorialUnit" AS ENUM ('FLAT', 'PER_HOUR', 'PER_UNIT');

-- CreateTable
CREATE TABLE "lanes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "originType" "LaneEndpointType" NOT NULL,
    "originLocationId" TEXT,
    "originCity" TEXT,
    "originState" TEXT,
    "originCountry" TEXT,
    "destinationType" "LaneEndpointType" NOT NULL,
    "destinationLocationId" TEXT,
    "destinationCity" TEXT,
    "destinationState" TEXT,
    "destinationCountry" TEXT,
    "originKey" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lanes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_breaks" (
    "id" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "upToKg" DOUBLE PRECISION NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "rate_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessorials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "AccessorialUnit" NOT NULL DEFAULT 'FLAT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accessorials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_accessorial_prices" (
    "id" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "accessorialId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "rate_accessorial_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_accessorials" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "accessorialId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "load_accessorials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_surcharge_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_surcharge_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_surcharge_entries" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "pct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "fuel_surcharge_entries_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add new columns to rates
ALTER TABLE "rates" ADD COLUMN "laneId" TEXT,
ADD COLUMN "fuelTableId" TEXT;

-- AlterTable: Add costDetail to loads
ALTER TABLE "loads" ADD COLUMN "costDetail" JSONB;

-- Data migration: each existing (origin, destination) preference pair becomes a
-- LOCATION→LOCATION lane (max specificity → auto-tender behaviour preserved identically).
-- Deterministic ids via md5 so reruns against a restored dump stay idempotent.
INSERT INTO "lanes" ("id", "tenantId", "originType", "originLocationId", "destinationType",
                     "destinationLocationId", "originKey", "destinationKey", "createdAt", "updatedAt")
SELECT 'lane_' || md5(p."tenantId" || ':' || p."originLocationId" || ':' || p."destinationLocationId"),
       p."tenantId", 'LOCATION', p."originLocationId", 'LOCATION', p."destinationLocationId",
       'LOCATION:' || p."originLocationId", 'LOCATION:' || p."destinationLocationId", now(), now()
FROM (SELECT DISTINCT "tenantId", "originLocationId", "destinationLocationId"
      FROM "lane_carrier_preferences") p;

-- Attach preferences to their lane, then drop the old endpoint columns.
ALTER TABLE "lane_carrier_preferences" ADD COLUMN "laneId" TEXT;

UPDATE "lane_carrier_preferences" lcp
SET "laneId" = l."id"
FROM "lanes" l
WHERE l."tenantId" = lcp."tenantId"
  AND l."originLocationId" = lcp."originLocationId"
  AND l."destinationLocationId" = lcp."destinationLocationId";

ALTER TABLE "lane_carrier_preferences" ALTER COLUMN "laneId" SET NOT NULL;

ALTER TABLE "lane_carrier_preferences"
  DROP CONSTRAINT IF EXISTS "lane_carrier_preferences_originLocationId_fkey",
  DROP CONSTRAINT IF EXISTS "lane_carrier_preferences_destinationLocationId_fkey";
ALTER TABLE "lane_carrier_preferences"
  DROP COLUMN "originLocationId",
  DROP COLUMN "destinationLocationId";

-- Drop old unique indexes on lane_carrier_preferences
DROP INDEX IF EXISTS "lane_prefs_lane_rank_key";
DROP INDEX IF EXISTS "lane_prefs_lane_carrier_key";

-- CreateIndex (new unique indexes for lane_carrier_preferences)
CREATE UNIQUE INDEX "lane_prefs_lane_rank_key" ON "lane_carrier_preferences"("tenantId", "laneId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "lane_prefs_lane_carrier_key" ON "lane_carrier_preferences"("tenantId", "laneId", "carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "lanes_tenantId_originKey_destinationKey_key" ON "lanes"("tenantId", "originKey", "destinationKey");

-- CreateIndex
CREATE INDEX "lanes_tenantId_idx" ON "lanes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "rate_breaks_rateId_upToKg_key" ON "rate_breaks"("rateId", "upToKg");

-- CreateIndex
CREATE UNIQUE INDEX "accessorials_tenantId_code_key" ON "accessorials"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rate_accessorial_prices_rateId_accessorialId_key" ON "rate_accessorial_prices"("rateId", "accessorialId");

-- CreateIndex
CREATE UNIQUE INDEX "load_accessorials_loadId_accessorialId_key" ON "load_accessorials"("loadId", "accessorialId");

-- CreateIndex
CREATE INDEX "fuel_surcharge_tables_tenantId_idx" ON "fuel_surcharge_tables"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_surcharge_entries_tableId_effectiveFrom_key" ON "fuel_surcharge_entries"("tableId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "rates_tenantId_laneId_idx" ON "rates"("tenantId", "laneId");

-- AddForeignKey
ALTER TABLE "lane_carrier_preferences" ADD CONSTRAINT "lane_carrier_preferences_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "lanes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "lanes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_fuelTableId_fkey" FOREIGN KEY ("fuelTableId") REFERENCES "fuel_surcharge_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_breaks" ADD CONSTRAINT "rate_breaks_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessorials" ADD CONSTRAINT "accessorials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_accessorial_prices" ADD CONSTRAINT "rate_accessorial_prices_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_accessorial_prices" ADD CONSTRAINT "rate_accessorial_prices_accessorialId_fkey" FOREIGN KEY ("accessorialId") REFERENCES "accessorials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_accessorials" ADD CONSTRAINT "load_accessorials_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_accessorials" ADD CONSTRAINT "load_accessorials_accessorialId_fkey" FOREIGN KEY ("accessorialId") REFERENCES "accessorials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_surcharge_tables" ADD CONSTRAINT "fuel_surcharge_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_surcharge_entries" ADD CONSTRAINT "fuel_surcharge_entries_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "fuel_surcharge_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
