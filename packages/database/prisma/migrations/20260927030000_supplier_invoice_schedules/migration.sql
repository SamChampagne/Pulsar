CREATE TYPE "SupplierScheduleStatus" AS ENUM ('CONFIRMED','WITHDRAWN');
CREATE TABLE "supplier_invoice_schedules" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "SupplierScheduleStatus" NOT NULL,
  "previousRevisionId" TEXT,
  "amountSnapshot" DECIMAL(12,2) NOT NULL,
  "currencySnapshot" TEXT NOT NULL,
  "creditsSnapshot" JSONB NOT NULL,
  "installments" JSONB NOT NULL,
  "note" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_invoice_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_schedule_amount_nonnegative" CHECK ("amountSnapshot">=0),
  CONSTRAINT "supplier_schedule_revision_chain" CHECK (("revision"=1 AND "previousRevisionId" IS NULL) OR ("revision">1 AND "previousRevisionId" IS NOT NULL)),
  CONSTRAINT "supplier_schedule_json_arrays" CHECK (jsonb_typeof("installments")='array' AND jsonb_array_length("installments")<=60 AND jsonb_typeof("creditsSnapshot")='array'),
  CONSTRAINT "supplier_schedule_withdrawal_empty" CHECK ("status"<>'WITHDRAWN' OR jsonb_array_length("installments")=0)
);
CREATE UNIQUE INDEX "supplier_invoice_schedules_tenantId_id_key" ON "supplier_invoice_schedules"("tenantId","id");
CREATE UNIQUE INDEX "supplier_invoice_schedules_tenantId_invoiceId_id_key" ON "supplier_invoice_schedules"("tenantId","invoiceId","id");
CREATE UNIQUE INDEX "supplier_invoice_schedules_tenantId_invoiceId_revision_key" ON "supplier_invoice_schedules"("tenantId","invoiceId","revision");
CREATE UNIQUE INDEX "supplier_invoice_schedules_tenantId_previousRevisionId_key" ON "supplier_invoice_schedules"("tenantId","previousRevisionId");
CREATE UNIQUE INDEX "supplier_invoice_schedules_tenantId_operationKey_key" ON "supplier_invoice_schedules"("tenantId","operationKey");
ALTER TABLE "supplier_invoice_schedules" ADD CONSTRAINT "supplier_invoice_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_schedules" ADD CONSTRAINT "supplier_invoice_schedules_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId","invoiceId") REFERENCES "supplier_invoices"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_schedules" ADD CONSTRAINT "supplier_invoice_schedules_tenantId_actorId_fkey" FOREIGN KEY ("tenantId","actorId") REFERENCES "users"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_schedules" ADD CONSTRAINT "supplier_invoice_schedules_tenantId_invoiceId_previousRevis_fkey" FOREIGN KEY ("tenantId","invoiceId","previousRevisionId") REFERENCES "supplier_invoice_schedules"("tenantId","invoiceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
