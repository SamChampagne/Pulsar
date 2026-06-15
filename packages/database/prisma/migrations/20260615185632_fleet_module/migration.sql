-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'REPAIR', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenanceOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplianceSubject" AS ENUM ('VEHICLE', 'TRAILER', 'DRIVER');

-- CreateEnum
CREATE TYPE "ComplianceDocType" AS ENUM ('REGISTRATION', 'INSURANCE', 'INSPECTION', 'LICENSE', 'MEDICAL', 'OTHER');

-- CreateTable
CREATE TABLE "maintenance_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "trailerId" TEXT,
    "type" "MaintenanceType" NOT NULL DEFAULT 'REPAIR',
    "status" "MaintenanceOrderStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "costAmount" DECIMAL(12,2),
    "costCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "vendor" TEXT,
    "dueDate" TIMESTAMP(3),
    "dueOdometerKm" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "ComplianceSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "docType" "ComplianceDocType" NOT NULL,
    "reference" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "documentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_orders_tenantId_status_idx" ON "maintenance_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "maintenance_orders_tenantId_vehicleId_idx" ON "maintenance_orders"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "compliance_documents_tenantId_subjectType_subjectId_idx" ON "compliance_documents"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "compliance_documents_tenantId_expiresAt_idx" ON "compliance_documents"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "trailers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
