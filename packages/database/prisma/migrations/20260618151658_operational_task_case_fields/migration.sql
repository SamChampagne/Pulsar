-- AlterTable
ALTER TABLE "operational_tasks" ADD COLUMN     "caseNumber" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "notes" JSONB,
ADD COLUMN     "slaDueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "operational_tasks_tenantId_status_slaDueAt_idx" ON "operational_tasks"("tenantId", "status", "slaDueAt");
