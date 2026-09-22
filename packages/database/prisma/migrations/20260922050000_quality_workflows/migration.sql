-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityNonconformityStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QualityOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "quality_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "criteria" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" "QualityOutcome",
    "receiptId" TEXT,
    "manufacturingOrderId" TEXT,
    "supportCaseId" TEXT,
    "operationKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_nonconformities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "QualityNonconformityStatus" NOT NULL DEFAULT 'OPEN',
    "rootCause" TEXT NOT NULL DEFAULT '',
    "correctiveAction" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_nonconformities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_plans_tenantId_active_idx" ON "quality_plans"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "quality_plans_tenantId_id_key" ON "quality_plans"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_plans_tenantId_code_key" ON "quality_plans"("tenantId", "code");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_status_idx" ON "quality_inspections"("tenantId", "status");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_receiptId_idx" ON "quality_inspections"("tenantId", "receiptId");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_manufacturingOrderId_idx" ON "quality_inspections"("tenantId", "manufacturingOrderId");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_supportCaseId_idx" ON "quality_inspections"("tenantId", "supportCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_tenantId_id_key" ON "quality_inspections"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_tenantId_number_key" ON "quality_inspections"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_tenantId_operationKey_key" ON "quality_inspections"("tenantId", "operationKey");

-- CreateIndex
CREATE INDEX "quality_nonconformities_tenantId_status_idx" ON "quality_nonconformities"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quality_nonconformities_tenantId_id_key" ON "quality_nonconformities"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_nonconformities_tenantId_inspectionId_key" ON "quality_nonconformities"("tenantId", "inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_nonconformities_tenantId_number_key" ON "quality_nonconformities"("tenantId", "number");

-- CreateIndex
CREATE INDEX "quality_events_tenantId_inspectionId_createdAt_idx" ON "quality_events"("tenantId", "inspectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_orders_tenantId_id_key" ON "manufacturing_orders"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "quality_plans" ADD CONSTRAINT "quality_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_planId_fkey" FOREIGN KEY ("tenantId", "planId") REFERENCES "quality_plans"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "wms_receipts"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_manufacturingOrderId_fkey" FOREIGN KEY ("tenantId", "manufacturingOrderId") REFERENCES "manufacturing_orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_supportCaseId_fkey" FOREIGN KEY ("tenantId", "supportCaseId") REFERENCES "support_cases"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_nonconformities" ADD CONSTRAINT "quality_nonconformities_tenantId_inspectionId_fkey" FOREIGN KEY ("tenantId", "inspectionId") REFERENCES "quality_inspections"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_events" ADD CONSTRAINT "quality_events_tenantId_inspectionId_fkey" FOREIGN KEY ("tenantId", "inspectionId") REFERENCES "quality_inspections"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_events" ADD CONSTRAINT "quality_events_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_source_at_most_one" CHECK (num_nonnulls("receiptId", "manufacturingOrderId", "supportCaseId") <= 1);
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_completion_outcome" CHECK (("status" = 'COMPLETED') = ("outcome" IS NOT NULL) AND ("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));

