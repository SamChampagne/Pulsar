-- CreateEnum
CREATE TYPE "PortalChangeRequestKind" AS ENUM ('DATE', 'ADDRESS', 'CANCEL', 'OTHER');

-- CreateEnum
CREATE TYPE "PortalChangeRequestStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "InboundSource" ADD VALUE 'EDI';

-- CreateTable
CREATE TABLE "portal_change_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "portalUserId" TEXT,
    "orderId" TEXT,
    "shipmentId" TEXT,
    "kind" "PortalChangeRequestKind" NOT NULL,
    "note" TEXT NOT NULL,
    "status" "PortalChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "staffResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "portal_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_change_requests_tenantId_customerId_status_idx" ON "portal_change_requests"("tenantId", "customerId", "status");

-- AddForeignKey
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
