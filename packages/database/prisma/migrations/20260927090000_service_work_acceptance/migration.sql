CREATE TYPE "ServiceAcceptanceStatus" AS ENUM ('PENDING', 'RESERVATIONS', 'ACCEPTED');
ALTER TABLE "service_projects" ADD COLUMN "acceptanceRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_jobs" ADD COLUMN "acceptanceStatus" "ServiceAcceptanceStatus" NOT NULL DEFAULT 'PENDING';
CREATE TABLE "service_acceptance_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "fromStatus" "ServiceAcceptanceStatus" NOT NULL,
  "toStatus" "ServiceAcceptanceStatus" NOT NULL,
  "representative" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "jobVersion" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_acceptance_records_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "service_jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_acceptance_records_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_acceptance_record_decision" CHECK ("toStatus" IN ('RESERVATIONS', 'ACCEPTED') AND "fromStatus" IN ('PENDING', 'RESERVATIONS'))
);
CREATE UNIQUE INDEX "service_acceptance_records_tenantId_operationKey_key" ON "service_acceptance_records"("tenantId", "operationKey");
CREATE INDEX "service_acceptance_records_tenantId_jobId_createdAt_idx" ON "service_acceptance_records"("tenantId", "jobId", "createdAt");
