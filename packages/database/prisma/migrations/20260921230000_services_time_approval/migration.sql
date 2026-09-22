ALTER TYPE "ServiceTimeStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "ServiceTimeStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ServiceTimeStatus" ADD VALUE 'REJECTED';
CREATE TYPE "ServiceTimeReviewAction" AS ENUM ('SUBMIT', 'WITHDRAW', 'APPROVE', 'REJECT', 'REOPEN', 'VOID', 'CORRECT');
ALTER TABLE "service_time_entries" DROP CONSTRAINT "service_time_void_reason";
ALTER TABLE "service_time_entries" ADD CONSTRAINT "service_time_void_reason" CHECK (("status" <> 'VOIDED' AND "voidReason" IS NULL) OR ("status" = 'VOIDED' AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0));
CREATE UNIQUE INDEX "service_time_entries_tenantId_id_key" ON "service_time_entries"("tenantId", "id");
CREATE INDEX "service_time_entries_tenantId_status_workDate_idx" ON "service_time_entries"("tenantId", "status", "workDate");
CREATE TABLE "service_time_reviews" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "timeEntryId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" "ServiceTimeReviewAction" NOT NULL,
  "fromStatus" "ServiceTimeStatus" NOT NULL,
  "toStatus" "ServiceTimeStatus" NOT NULL,
  "reason" TEXT,
  "snapshot" JSONB NOT NULL,
  "entryVersion" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_time_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_time_review_reason" CHECK ("action" NOT IN ('REJECT', 'REOPEN', 'VOID') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))
);
CREATE UNIQUE INDEX "service_time_reviews_tenantId_timeEntryId_entryVersion_key" ON "service_time_reviews"("tenantId", "timeEntryId", "entryVersion");
CREATE INDEX "service_time_reviews_tenantId_timeEntryId_createdAt_idx" ON "service_time_reviews"("tenantId", "timeEntryId", "createdAt");
ALTER TABLE "service_time_reviews" ADD CONSTRAINT "service_time_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_reviews" ADD CONSTRAINT "service_time_reviews_tenantId_timeEntryId_fkey" FOREIGN KEY ("tenantId", "timeEntryId") REFERENCES "service_time_entries"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_time_reviews" ADD CONSTRAINT "service_time_reviews_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
