CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TABLE "support_cases" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "number" TEXT NOT NULL,
 "partnerId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
 "priority" TEXT NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW','NORMAL','HIGH','URGENT')),
 "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN', "jobId" TEXT,
 "resolution" TEXT NOT NULL DEFAULT '', "operationKey" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "support_case_events" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "caseId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL, "note" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "support_cases_tenantId_status_priority_idx" ON "support_cases"("tenantId", "status", "priority");
CREATE UNIQUE INDEX "support_cases_tenantId_id_key" ON "support_cases"("tenantId", "id");
CREATE UNIQUE INDEX "support_cases_tenantId_number_key" ON "support_cases"("tenantId", "number");
CREATE UNIQUE INDEX "support_cases_tenantId_operationKey_key" ON "support_cases"("tenantId", "operationKey");
CREATE INDEX "support_case_events_tenantId_caseId_createdAt_idx" ON "support_case_events"("tenantId", "caseId", "createdAt");
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_tenantId_partnerId_fkey" FOREIGN KEY ("tenantId", "partnerId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "service_jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_case_events" ADD CONSTRAINT "support_case_events_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "support_cases"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_case_events" ADD CONSTRAINT "support_case_events_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
