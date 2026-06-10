-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "isAuto" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lane_carrier_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "lane_carrier_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lane_prefs_lane_rank_key" ON "lane_carrier_preferences"("tenantId", "originLocationId", "destinationLocationId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "lane_prefs_lane_carrier_key" ON "lane_carrier_preferences"("tenantId", "originLocationId", "destinationLocationId", "carrierId");

-- CreateIndex
CREATE INDEX "tenders_status_expiresAt_idx" ON "tenders"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "lane_carrier_preferences" ADD CONSTRAINT "lane_carrier_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lane_carrier_preferences" ADD CONSTRAINT "lane_carrier_preferences_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lane_carrier_preferences" ADD CONSTRAINT "lane_carrier_preferences_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lane_carrier_preferences" ADD CONSTRAINT "lane_carrier_preferences_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

