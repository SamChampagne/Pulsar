CREATE UNIQUE INDEX "wms_stock_exit_evidence_tenantId_stockExitId_id_key" ON "wms_stock_exit_evidence"("tenantId", "stockExitId", "id");
CREATE TABLE "supplier_return_reports" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "stockExitId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "received" DECIMAL(14,3) NOT NULL,
  "accepted" DECIMAL(14,3) NOT NULL,
  "refused" DECIMAL(14,3) NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "correctionReason" TEXT,
  "operationKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_return_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_return_reports_quantities_check" CHECK ("received" >= 0 AND "accepted" >= 0 AND "refused" >= 0 AND "accepted" + "refused" <= "received"),
  CONSTRAINT "supplier_return_reports_content_check" CHECK ("revision" > 0 AND length(btrim("reference")) >= 3 AND length(btrim("note")) >= 10 AND ("correctionReason" IS NULL OR length(btrim("correctionReason")) >= 10)),
  CONSTRAINT "supplier_return_reports_exit_fk" FOREIGN KEY ("tenantId", "stockExitId") REFERENCES "wms_stock_exits"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_reports_evidence_fk" FOREIGN KEY ("tenantId", "stockExitId", "evidenceId") REFERENCES "wms_stock_exit_evidence"("tenantId", "stockExitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_reports_author_fk" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "supplier_return_reports_tenantId_stockExitId_revision_key" ON "supplier_return_reports"("tenantId", "stockExitId", "revision");
CREATE UNIQUE INDEX "supplier_return_reports_tenantId_operationKey_key" ON "supplier_return_reports"("tenantId", "operationKey");
