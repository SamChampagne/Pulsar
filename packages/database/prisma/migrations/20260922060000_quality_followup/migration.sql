ALTER TABLE "quality_nonconformities" ADD COLUMN "assigneeUserId" TEXT,
ADD COLUMN "dueDate" DATE;

CREATE TABLE "quality_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quality_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quality_evidence_tenantId_nonconformityId_idx" ON "quality_evidence"("tenantId", "nonconformityId");
CREATE UNIQUE INDEX "quality_evidence_tenantId_operationKey_key" ON "quality_evidence"("tenantId", "operationKey");
CREATE UNIQUE INDEX "quality_evidence_tenantId_documentId_key" ON "quality_evidence"("tenantId", "documentId");
CREATE UNIQUE INDEX "documents_tenantId_id_key" ON "documents"("tenantId", "id");
CREATE INDEX "quality_nonconformities_tenantId_assigneeUserId_dueDate_idx" ON "quality_nonconformities"("tenantId", "assigneeUserId", "dueDate");

ALTER TABLE "quality_nonconformities" ADD CONSTRAINT "quality_nonconformities_tenantId_assigneeUserId_fkey" FOREIGN KEY ("tenantId", "assigneeUserId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "quality_evidence" ADD CONSTRAINT "quality_evidence_tenantId_nonconformityId_fkey" FOREIGN KEY ("tenantId", "nonconformityId") REFERENCES "quality_nonconformities"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_evidence" ADD CONSTRAINT "quality_evidence_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
