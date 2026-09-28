-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'QUALIFIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSnapshot" JSONB NOT NULL,
    "externalNumber" TEXT NOT NULL,
    "externalNumberKey" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" TEXT NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "taxes" JSONB NOT NULL,
    "originalEvidenceId" TEXT,
    "qualificationNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(13,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "purchaseLineId" TEXT,
    "purchaseSnapshot" JSONB,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoice_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoice_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_tenantId_status_createdAt_idx" ON "supplier_invoices"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_tenantId_id_key" ON "supplier_invoices"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_tenantId_number_key" ON "supplier_invoices"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_tenantId_supplierId_externalNumberKey_key" ON "supplier_invoices"("tenantId", "supplierId", "externalNumberKey");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_tenantId_id_key" ON "supplier_invoice_lines"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_tenantId_invoiceId_position_key" ON "supplier_invoice_lines"("tenantId", "invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_evidence_tenantId_id_key" ON "supplier_invoice_evidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_evidence_tenantId_invoiceId_id_key" ON "supplier_invoice_evidence"("tenantId", "invoiceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_evidence_tenantId_documentId_key" ON "supplier_invoice_evidence"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_evidence_tenantId_operationKey_key" ON "supplier_invoice_evidence"("tenantId", "operationKey");

-- CreateIndex
CREATE INDEX "supplier_invoice_operations_tenantId_invoiceId_createdAt_idx" ON "supplier_invoice_operations"("tenantId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_operations_tenantId_operationKey_key" ON "supplier_invoice_operations"("tenantId", "operationKey");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_id_originalEvidenceId_fkey" FOREIGN KEY ("tenantId", "id", "originalEvidenceId") REFERENCES "supplier_invoice_evidence"("tenantId", "invoiceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "supplier_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tenantId_purchaseLineId_fkey" FOREIGN KEY ("tenantId", "purchaseLineId") REFERENCES "supplier_order_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_evidence" ADD CONSTRAINT "supplier_invoice_evidence_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "supplier_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_evidence" ADD CONSTRAINT "supplier_invoice_evidence_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_operations" ADD CONSTRAINT "supplier_invoice_operations_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "supplier_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_operations" ADD CONSTRAINT "supplier_invoice_operations_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Declared totals and closure must remain coherent even outside the application.
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoice_totals_check" CHECK ("netAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" = "netAmount" + "taxAmount");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoice_dates_check" CHECK ("dueDate" IS NULL OR "dueDate" >= "invoiceDate");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoice_close_check" CHECK (("status" = 'DRAFT' AND "closedAt" IS NULL AND "originalEvidenceId" IS NULL) OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL AND "originalEvidenceId" IS NULL) OR ("status" = 'QUALIFIED' AND "closedAt" IS NOT NULL AND "originalEvidenceId" IS NOT NULL));
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_line_amount_check" CHECK ("quantity" > 0 AND "netAmount" >= 0);
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_source_pair_check" CHECK (("purchaseLineId" IS NULL AND ("purchaseSnapshot" IS NULL OR "purchaseSnapshot" = 'null'::jsonb)) OR ("purchaseLineId" IS NOT NULL AND "purchaseSnapshot" IS NOT NULL AND jsonb_typeof("purchaseSnapshot") = 'object'));
