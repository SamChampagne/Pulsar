-- CreateIndex
CREATE INDEX "domain_events_tenantId_subjectType_subjectId_idx" ON "domain_events"("tenantId", "subjectType", "subjectId");
