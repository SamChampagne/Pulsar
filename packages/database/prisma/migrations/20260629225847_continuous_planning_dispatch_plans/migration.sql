-- CreateEnum
CREATE TYPE "DispatchPlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'COMMITTED', 'DISCARDED');

-- CreateTable
CREATE TABLE "dispatch_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planNumber" TEXT NOT NULL,
    "status" "DispatchPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "engine" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdById" TEXT,
    "committedById" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_plan_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "shipmentIds" TEXT[],
    "resultLoadId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispatch_plans_tenantId_status_idx" ON "dispatch_plans"("tenantId", "status");

-- CreateIndex
CREATE INDEX "dispatch_plans_tenantId_createdAt_idx" ON "dispatch_plans"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "dispatch_plan_items_tenantId_planId_idx" ON "dispatch_plan_items"("tenantId", "planId");

-- AddForeignKey
ALTER TABLE "dispatch_plans" ADD CONSTRAINT "dispatch_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_plan_items" ADD CONSTRAINT "dispatch_plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "dispatch_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
