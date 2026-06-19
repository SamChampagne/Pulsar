-- CreateEnum
CREATE TYPE "RfpStatus" AS ENUM ('DRAFT', 'OPEN', 'EVALUATION', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('SENT', 'RESPONDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "rfps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfpNumber" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RfpStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfp_lanes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,
    "mode" "TransportMode",
    "volumeEstimate" INTEGER,

    CONSTRAINT "rfp_lanes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfp_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "rfp_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "rfpLaneId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "rateType" "RateType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "transitDays" INTEGER,
    "notes" TEXT,
    "status" "BidStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfpLaneId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "bidId" TEXT,
    "rateId" TEXT,
    "awardedById" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rfps_tenantId_status_createdAt_idx" ON "rfps"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "rfp_lanes_tenantId_rfpId_idx" ON "rfp_lanes"("tenantId", "rfpId");

-- CreateIndex
CREATE UNIQUE INDEX "rfp_invites_token_key" ON "rfp_invites"("token");

-- CreateIndex
CREATE INDEX "rfp_invites_tenantId_rfpId_idx" ON "rfp_invites"("tenantId", "rfpId");

-- CreateIndex
CREATE INDEX "bids_tenantId_rfpId_idx" ON "bids"("tenantId", "rfpId");

-- CreateIndex
CREATE INDEX "bids_tenantId_rfpLaneId_idx" ON "bids"("tenantId", "rfpLaneId");

-- CreateIndex
CREATE UNIQUE INDEX "awards_rfpLaneId_key" ON "awards"("rfpLaneId");

-- AddForeignKey
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfp_lanes" ADD CONSTRAINT "rfp_lanes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfp_lanes" ADD CONSTRAINT "rfp_lanes_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfp_invites" ADD CONSTRAINT "rfp_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfp_invites" ADD CONSTRAINT "rfp_invites_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_rfpLaneId_fkey" FOREIGN KEY ("rfpLaneId") REFERENCES "rfp_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_rfpLaneId_fkey" FOREIGN KEY ("rfpLaneId") REFERENCES "rfp_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
