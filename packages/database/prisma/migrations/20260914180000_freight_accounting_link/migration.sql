-- A documentary one-to-one link. No invoice, payment or journal entry is created.
ALTER TABLE "incoming_carrier_invoices" ADD COLUMN "accountingInvoiceId" TEXT;
CREATE UNIQUE INDEX "invoices_tenantId_id_key" ON "invoices"("tenantId", "id");
CREATE UNIQUE INDEX "incoming_carrier_invoices_tenantId_accountingInvoiceId_key"
  ON "incoming_carrier_invoices"("tenantId", "accountingInvoiceId");
ALTER TABLE "incoming_carrier_invoices" ADD CONSTRAINT "incoming_carrier_invoices_accounting_invoice_fkey"
  FOREIGN KEY ("tenantId", "accountingInvoiceId") REFERENCES "invoices"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
