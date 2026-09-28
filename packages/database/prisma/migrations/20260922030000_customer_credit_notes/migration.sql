CREATE TYPE "CustomerCreditStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');
ALTER TABLE "customer_invoices" ADD COLUMN "creditedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "creditVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_credit_bounds" CHECK ("creditedAmount" >= 0 AND "creditedAmount" <= "totalAmount");
CREATE UNIQUE INDEX "customer_invoices_tenantId_id_key" ON "customer_invoices"("tenantId", "id");
CREATE TABLE "customer_credit_notes" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "number" TEXT NOT NULL,
  "status" "CustomerCreditStatus" NOT NULL DEFAULT 'DRAFT', "reason" TEXT NOT NULL,
  "currency" TEXT NOT NULL, "invoiceVersion" INTEGER NOT NULL,
  "netAmount" DECIMAL(12,2) NOT NULL, "taxAmount" DECIMAL(12,2) NOT NULL, "totalAmount" DECIMAL(12,2) NOT NULL,
  "createdById" TEXT NOT NULL, "issuedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  CONSTRAINT "credit_note_amounts" CHECK ("netAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" > 0 AND "totalAmount" = "netAmount" + "taxAmount"),
  CONSTRAINT "credit_note_reason" CHECK (length(trim("reason")) > 0),
  FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "customer_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId", "issuedById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customer_credit_notes_tenantId_id_key" ON "customer_credit_notes"("tenantId", "id");
CREATE UNIQUE INDEX "customer_credit_notes_tenantId_number_key" ON "customer_credit_notes"("tenantId", "number");
CREATE UNIQUE INDEX "customer_credit_notes_tenantId_operationKey_key" ON "customer_credit_notes"("tenantId", "operationKey");
CREATE INDEX "customer_credit_notes_tenantId_invoiceId_createdAt_idx" ON "customer_credit_notes"("tenantId", "invoiceId", "createdAt");
CREATE TABLE "customer_credit_lines" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "creditNoteId" TEXT NOT NULL, "invoiceLineId" TEXT NOT NULL,
  "description" TEXT NOT NULL, "quantity" DECIMAL(14,4) NOT NULL,
  "netAmount" DECIMAL(12,2) NOT NULL, "taxAmount" DECIMAL(12,2) NOT NULL, "totalAmount" DECIMAL(12,2) NOT NULL, "taxDetail" JSONB NOT NULL,
  CONSTRAINT "credit_line_amounts" CHECK ("quantity" > 0 AND "netAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" = "netAmount" + "taxAmount"),
  FOREIGN KEY ("tenantId", "creditNoteId") REFERENCES "customer_credit_notes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("invoiceLineId") REFERENCES "customer_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customer_credit_lines_tenantId_id_key" ON "customer_credit_lines"("tenantId", "id");
CREATE UNIQUE INDEX "customer_credit_lines_tenantId_creditNoteId_invoiceLineId_key" ON "customer_credit_lines"("tenantId", "creditNoteId", "invoiceLineId");
CREATE INDEX "customer_credit_lines_tenantId_invoiceLineId_idx" ON "customer_credit_lines"("tenantId", "invoiceLineId");
ALTER TABLE "service_part_returns" ADD COLUMN "creditLineId" TEXT;
ALTER TABLE "service_part_returns" ADD CONSTRAINT "service_part_returns_tenantId_creditLineId_fkey"
  FOREIGN KEY ("tenantId", "creditLineId") REFERENCES "customer_credit_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
