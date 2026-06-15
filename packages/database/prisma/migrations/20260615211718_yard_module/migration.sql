-- CreateEnum
CREATE TYPE "YardSpotType" AS ENUM ('DOCK_DOOR', 'PARKING', 'STAGING');

-- CreateEnum
CREATE TYPE "YardDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "YardVisitStatus" AS ENUM ('CHECKED_IN', 'ASSIGNED', 'DEPARTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DockAppointmentStatus" AS ENUM ('SCHEDULED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "yard_spots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "YardSpotType" NOT NULL DEFAULT 'PARKING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yard_spots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "trailerId" TEXT,
    "trailerRef" TEXT,
    "carrierId" TEXT,
    "driverName" TEXT,
    "direction" "YardDirection" NOT NULL DEFAULT 'OTHER',
    "status" "YardVisitStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "spotId" TEXT,
    "appointmentId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yard_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard_moves" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "fromSpotId" TEXT,
    "toSpotId" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT,

    CONSTRAINT "yard_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dock_appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "spotId" TEXT,
    "carrierId" TEXT,
    "direction" "YardDirection" NOT NULL DEFAULT 'INBOUND',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "status" "DockAppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dock_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "yard_spots_tenantId_locationId_idx" ON "yard_spots"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "yard_spots_tenantId_locationId_code_key" ON "yard_spots"("tenantId", "locationId", "code");

-- CreateIndex
CREATE INDEX "yard_visits_tenantId_status_idx" ON "yard_visits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "yard_visits_tenantId_spotId_idx" ON "yard_visits"("tenantId", "spotId");

-- CreateIndex
CREATE UNIQUE INDEX "yard_visits_tenantId_visitNumber_key" ON "yard_visits"("tenantId", "visitNumber");

-- CreateIndex
CREATE INDEX "yard_moves_tenantId_visitId_idx" ON "yard_moves"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "dock_appointments_tenantId_status_idx" ON "dock_appointments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "dock_appointments_tenantId_windowStart_idx" ON "dock_appointments"("tenantId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "dock_appointments_tenantId_appointmentNumber_key" ON "dock_appointments"("tenantId", "appointmentNumber");

-- AddForeignKey
ALTER TABLE "yard_spots" ADD CONSTRAINT "yard_spots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_spots" ADD CONSTRAINT "yard_spots_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "trailers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "yard_spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_visits" ADD CONSTRAINT "yard_visits_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "dock_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_moves" ADD CONSTRAINT "yard_moves_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_moves" ADD CONSTRAINT "yard_moves_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "yard_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_moves" ADD CONSTRAINT "yard_moves_fromSpotId_fkey" FOREIGN KEY ("fromSpotId") REFERENCES "yard_spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_moves" ADD CONSTRAINT "yard_moves_toSpotId_fkey" FOREIGN KEY ("toSpotId") REFERENCES "yard_spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_appointments" ADD CONSTRAINT "dock_appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_appointments" ADD CONSTRAINT "dock_appointments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_appointments" ADD CONSTRAINT "dock_appointments_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "yard_spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_appointments" ADD CONSTRAINT "dock_appointments_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
