ALTER TABLE "supplier_orders" ADD COLUMN "closeReason" TEXT;
CREATE TABLE "supplier_receipts" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
 "receiptId" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "supplier_receipt_lines" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "supplierReceiptId" TEXT NOT NULL,
 "orderLineId" TEXT NOT NULL, "receiptLineId" TEXT NOT NULL, "unitSnapshot" TEXT NOT NULL
);
CREATE INDEX "supplier_receipts_tenantId_orderId_idx" ON "supplier_receipts"("tenantId", "orderId");
CREATE UNIQUE INDEX "supplier_receipts_tenantId_id_key" ON "supplier_receipts"("tenantId", "id");
CREATE UNIQUE INDEX "supplier_receipts_tenantId_operationKey_key" ON "supplier_receipts"("tenantId", "operationKey");
CREATE UNIQUE INDEX "supplier_receipts_tenantId_receiptId_key" ON "supplier_receipts"("tenantId", "receiptId");
CREATE INDEX "supplier_receipt_lines_tenantId_orderLineId_idx" ON "supplier_receipt_lines"("tenantId", "orderLineId");
CREATE UNIQUE INDEX "supplier_receipt_lines_tenantId_receiptLineId_key" ON "supplier_receipt_lines"("tenantId", "receiptLineId");
CREATE UNIQUE INDEX "supplier_order_lines_tenantId_id_key" ON "supplier_order_lines"("tenantId", "id");
CREATE UNIQUE INDEX "wms_receipt_lines_tenantId_id_key" ON "wms_receipt_lines"("tenantId", "id");
CREATE UNIQUE INDEX "wms_receipts_tenantId_id_key" ON "wms_receipts"("tenantId", "id");
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "supplier_orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "wms_receipts"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_tenantId_supplierReceiptId_fkey" FOREIGN KEY ("tenantId", "supplierReceiptId") REFERENCES "supplier_receipts"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_tenantId_orderLineId_fkey" FOREIGN KEY ("tenantId", "orderLineId") REFERENCES "supplier_order_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_tenantId_receiptLineId_fkey" FOREIGN KEY ("tenantId", "receiptLineId") REFERENCES "wms_receipt_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
