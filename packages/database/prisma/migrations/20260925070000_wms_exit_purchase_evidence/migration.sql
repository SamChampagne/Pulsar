CREATE UNIQUE INDEX "supplier_receipt_lines_tenantId_id_key" ON "supplier_receipt_lines"("tenantId","id");
ALTER TABLE "wms_stock_exits" ADD COLUMN "purchaseSourceId" TEXT, ADD COLUMN "purchaseSnapshot" JSONB;
ALTER TABLE "wms_stock_exits" ADD CONSTRAINT "wms_stock_exits_purchase_check" CHECK (
 ("purchaseSourceId" IS NULL AND "purchaseSnapshot" IS NULL) OR
 ("purchaseSourceId" IS NOT NULL AND "purchaseSnapshot" IS NOT NULL AND "kind"='SUPPLIER_RETURN'));
ALTER TABLE "wms_stock_exits" ADD CONSTRAINT "wms_stock_exits_tenantId_purchaseSourceId_fkey" FOREIGN KEY ("tenantId","purchaseSourceId") REFERENCES "supplier_receipt_lines"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "wms_stock_exits_tenantId_purchaseSourceId_status_idx" ON "wms_stock_exits"("tenantId","purchaseSourceId","status");
CREATE TABLE "wms_stock_exit_evidence" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "stockExitId" TEXT NOT NULL,
 "documentId" TEXT NOT NULL, "caption" TEXT NOT NULL, "sha256" TEXT NOT NULL,
 "recordedStatus" "StockExitStatus" NOT NULL, "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "wms_stock_exit_evidence_content_check" CHECK (length(btrim("caption")) BETWEEN 3 AND 1000 AND "sha256" ~ '^[a-f0-9]{64}$' AND "recordedStatus" IN ('DRAFT','POSTED')),
 CONSTRAINT "wms_stock_exit_evidence_tenantId_stockExitId_fkey" FOREIGN KEY ("tenantId","stockExitId") REFERENCES "wms_stock_exits"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "wms_stock_exit_evidence_tenantId_documentId_fkey" FOREIGN KEY ("tenantId","documentId") REFERENCES "documents"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wms_stock_exit_evidence_tenantId_operationKey_key" ON "wms_stock_exit_evidence"("tenantId","operationKey");
CREATE UNIQUE INDEX "wms_stock_exit_evidence_tenantId_documentId_key" ON "wms_stock_exit_evidence"("tenantId","documentId");
CREATE INDEX "wms_stock_exit_evidence_tenantId_stockExitId_createdAt_idx" ON "wms_stock_exit_evidence"("tenantId","stockExitId","createdAt");
