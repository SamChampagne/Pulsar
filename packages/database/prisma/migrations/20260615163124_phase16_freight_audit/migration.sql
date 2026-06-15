-- CreateEnum
CREATE TYPE "FreightAuditStatus" AS ENUM ('RECEIVED', 'MATCHED', 'FLAGGED', 'DISPUTED', 'RESOLVED', 'PAID');

-- CreateTable
CREATE TABLE "incoming_carrier_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "carrierInvoiceNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "chargedTotal" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FreightAuditStatus" NOT NULL DEFAULT 'RECEIVED',
    "matchedTotal" DECIMAL(12,2),
    "varianceTotal" DECIMAL(12,2),
    "varianceGross" DECIMAL(12,2),
    "recoveredAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "resolution" TEXT,
    "disputeReasonCode" TEXT,
    "disputeNote" TEXT,
    "auditedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "sourceRef" TEXT NOT NULL DEFAULT 'manual',
    "disputedByAgentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_carrier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineRef" TEXT NOT NULL,
    "description" TEXT,
    "chargedAmount" DECIMAL(12,2) NOT NULL,
    "matchedLoadId" TEXT,
    "expectedAmount" DECIMAL(12,2),
    "variance" DECIMAL(12,2),

    CONSTRAINT "incoming_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incoming_carrier_invoices_tenantId_status_idx" ON "incoming_carrier_invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "incoming_invoice_lines_invoiceId_idx" ON "incoming_invoice_lines"("invoiceId");

-- AddForeignKey
ALTER TABLE "incoming_carrier_invoices" ADD CONSTRAINT "incoming_carrier_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_carrier_invoices" ADD CONSTRAINT "incoming_carrier_invoices_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoice_lines" ADD CONSTRAINT "incoming_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "incoming_carrier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
