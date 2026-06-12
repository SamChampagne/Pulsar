-- CreateEnum
CREATE TYPE "DistanceSource" AS ENUM ('MANUAL', 'OSRM', 'HAVERSINE');

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "distanceSource" "DistanceSource",
ADD COLUMN     "geometry" JSONB;

-- CreateTable
CREATE TABLE "geocode_cache" (
    "id" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geocode_cache_addressKey_key" ON "geocode_cache"("addressKey");
