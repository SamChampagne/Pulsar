-- CreateTable
CREATE TABLE "scheduling_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apsScheduleId" TEXT,
    "strategy" TEXT NOT NULL,
    "solverStatus" TEXT NOT NULL,
    "objectiveValue" INTEGER NOT NULL DEFAULT 0,
    "wallTimeMs" INTEGER NOT NULL DEFAULT 0,
    "horizonStart" TIMESTAMP(3),
    "horizonEnd" TIMESTAMP(3),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "operationCount" INTEGER NOT NULL DEFAULT 0,
    "assignmentCount" INTEGER NOT NULL DEFAULT 0,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "snapshotHash" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diagnostics" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduling_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_manufacturing_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "setupStart" TIMESTAMP(3) NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_manufacturing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduling_runs_tenantId_createdAt_idx" ON "scheduling_runs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduling_runs_tenantId_isBaseline_idx" ON "scheduling_runs"("tenantId", "isBaseline");

-- CreateIndex
CREATE INDEX "scheduled_manufacturing_operations_tenantId_runId_idx" ON "scheduled_manufacturing_operations"("tenantId", "runId");

-- AddForeignKey
ALTER TABLE "scheduling_runs" ADD CONSTRAINT "scheduling_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_manufacturing_operations" ADD CONSTRAINT "scheduled_manufacturing_operations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "scheduling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
