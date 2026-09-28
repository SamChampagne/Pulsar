-- CreateEnum
CREATE TYPE "SupplierCreditStatus" AS ENUM ('DRAFT', 'QUALIFIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "supplier_credits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "externalNumber" TEXT NOT NULL,
    "externalNumberKey" TEXT NOT NULL,
    "creditDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SupplierCreditStatus" NOT NULL DEFAULT 'DRAFT',
    "netAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "taxes" JSONB NOT NULL,
    "returnReportId" TEXT,
    "returnSnapshot" JSONB,
    "originalEvidenceId" TEXT,
    "qualificationNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "supplier_credit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_credit_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_credit_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_credits_tenantId_invoiceId_status_idx" ON "supplier_credits"("tenantId", "invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credits_tenantId_id_key" ON "supplier_credits"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credits_tenantId_number_key" ON "supplier_credits"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credits_tenantId_supplierId_externalNumberKey_key" ON "supplier_credits"("tenantId", "supplierId", "externalNumberKey");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_lines_tenantId_creditId_invoiceLineId_key" ON "supplier_credit_lines"("tenantId", "creditId", "invoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_evidence_tenantId_id_key" ON "supplier_credit_evidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_evidence_tenantId_creditId_id_key" ON "supplier_credit_evidence"("tenantId", "creditId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_evidence_tenantId_documentId_key" ON "supplier_credit_evidence"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_evidence_tenantId_operationKey_key" ON "supplier_credit_evidence"("tenantId", "operationKey");

-- CreateIndex
CREATE INDEX "supplier_credit_operations_tenantId_creditId_createdAt_idx" ON "supplier_credit_operations"("tenantId", "creditId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_operations_tenantId_operationKey_key" ON "supplier_credit_operations"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_reports_tenantId_id_key" ON "supplier_return_reports"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "supplier_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_tenantId_returnReportId_fkey" FOREIGN KEY ("tenantId", "returnReportId") REFERENCES "supplier_return_reports"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_tenantId_id_originalEvidenceId_fkey" FOREIGN KEY ("tenantId", "id", "originalEvidenceId") REFERENCES "supplier_credit_evidence"("tenantId", "creditId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_lines" ADD CONSTRAINT "supplier_credit_lines_tenantId_creditId_fkey" FOREIGN KEY ("tenantId", "creditId") REFERENCES "supplier_credits"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_lines" ADD CONSTRAINT "supplier_credit_lines_tenantId_invoiceLineId_fkey" FOREIGN KEY ("tenantId", "invoiceLineId") REFERENCES "supplier_invoice_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_evidence" ADD CONSTRAINT "supplier_credit_evidence_tenantId_creditId_fkey" FOREIGN KEY ("tenantId", "creditId") REFERENCES "supplier_credits"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_evidence" ADD CONSTRAINT "supplier_credit_evidence_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_operations" ADD CONSTRAINT "supplier_credit_operations_tenantId_creditId_fkey" FOREIGN KEY ("tenantId", "creditId") REFERENCES "supplier_credits"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_operations" ADD CONSTRAINT "supplier_credit_operations_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_amounts_check" CHECK ("netAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" > 0 AND "totalAmount" = "netAmount" + "taxAmount");
ALTER TABLE "supplier_credit_lines" ADD CONSTRAINT "supplier_credit_lines_amount_check" CHECK ("netAmount" >= 0);
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_closure_check" CHECK (
 ("status" = 'DRAFT' AND "closedAt" IS NULL AND "originalEvidenceId" IS NULL) OR
 ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL AND "originalEvidenceId" IS NULL) OR
 ("status" = 'QUALIFIED' AND "closedAt" IS NOT NULL AND "originalEvidenceId" IS NOT NULL));
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_return_check" CHECK (
 ("returnReportId" IS NULL AND ("returnSnapshot" IS NULL OR "returnSnapshot" = 'null'::jsonb)) OR
 ("returnReportId" IS NOT NULL AND "returnSnapshot" IS NOT NULL AND "returnSnapshot" <> 'null'::jsonb));
