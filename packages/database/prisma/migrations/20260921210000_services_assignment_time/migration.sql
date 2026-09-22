CREATE TYPE "ServiceTimeStatus" AS ENUM ('RECORDED', 'VOIDED');
ALTER TABLE "service_jobs" ADD COLUMN "assigneeUserId" TEXT;
CREATE TABLE "service_time_entries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "minutes" INTEGER NOT NULL,
  "billable" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT NOT NULL,
  "status" "ServiceTimeStatus" NOT NULL DEFAULT 'RECORDED',
  "voidReason" TEXT,
  "operationKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_time_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_time_minutes_range" CHECK ("minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "service_time_note_required" CHECK (length(btrim("note")) > 0),
  CONSTRAINT "service_time_void_reason" CHECK (("status" = 'RECORDED' AND "voidReason" IS NULL) OR ("status" = 'VOIDED' AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0))
);
CREATE INDEX "service_time_entries_tenantId_jobId_workDate_idx" ON "service_time_entries"("tenantId", "jobId", "workDate");
CREATE INDEX "service_time_entries_tenantId_userId_workDate_status_idx" ON "service_time_entries"("tenantId", "userId", "workDate", "status");
CREATE UNIQUE INDEX "service_time_entries_tenantId_operationKey_key" ON "service_time_entries"("tenantId", "operationKey");
CREATE INDEX "service_jobs_tenantId_assigneeUserId_status_idx" ON "service_jobs"("tenantId", "assigneeUserId", "status");
CREATE UNIQUE INDEX "service_jobs_tenantId_id_key" ON "service_jobs"("tenantId", "id");
CREATE UNIQUE INDEX "users_tenantId_id_key" ON "users"("tenantId", "id");
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_tenantId_assigneeUserId_fkey" FOREIGN KEY ("tenantId", "assigneeUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_entries" ADD CONSTRAINT "service_time_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_entries" ADD CONSTRAINT "service_time_entries_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "service_jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_entries" ADD CONSTRAINT "service_time_entries_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_entries" ADD CONSTRAINT "service_time_entries_tenantId_createdById_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
