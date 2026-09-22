-- CreateEnum
CREATE TYPE "ServiceQuoteStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "business_partners" ADD COLUMN     "billingCustomerId" TEXT,
ADD COLUMN     "crmCompanyId" TEXT;

-- AlterTable
ALTER TABLE "customer_invoice_lines" ADD COLUMN     "servicePartUsageId" TEXT,
ADD COLUMN     "serviceTimeEntryId" TEXT;

-- AlterTable
ALTER TABLE "service_jobs" ADD COLUMN     "plannedMinutes" INTEGER,
ADD COLUMN     "workCenterId" TEXT;

-- CreateTable
CREATE TABLE "service_job_skill_requirements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "service_job_skill_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" "ServiceQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE,
    "projectId" TEXT,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "service_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_invoice_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_invoice_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_job_skill_requirements_tenantId_jobId_skillId_key" ON "service_job_skill_requirements"("tenantId", "jobId", "skillId");

-- CreateIndex
CREATE INDEX "service_quotes_tenantId_status_idx" ON "service_quotes"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_quotes_tenantId_id_key" ON "service_quotes"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_quotes_tenantId_number_key" ON "service_quotes"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "service_quotes_tenantId_operationKey_key" ON "service_quotes"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "service_quotes_tenantId_projectId_key" ON "service_quotes"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoice_batches_invoiceId_key" ON "service_invoice_batches"("invoiceId");

-- CreateIndex
CREATE INDEX "service_invoice_batches_tenantId_projectId_idx" ON "service_invoice_batches"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoice_batches_tenantId_operationKey_key" ON "service_invoice_batches"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_tenantId_billingCustomerId_key" ON "business_partners"("tenantId", "billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_tenantId_crmCompanyId_key" ON "business_partners"("tenantId", "crmCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_companies_tenantId_id_key" ON "crm_companies"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_lines_serviceTimeEntryId_key" ON "customer_invoice_lines"("serviceTimeEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_lines_servicePartUsageId_key" ON "customer_invoice_lines"("servicePartUsageId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");

-- CreateIndex
CREATE INDEX "service_jobs_tenantId_scheduledAt_idx" ON "service_jobs"("tenantId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_tenantId_billingCustomerId_fkey" FOREIGN KEY ("tenantId", "billingCustomerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_tenantId_crmCompanyId_fkey" FOREIGN KEY ("tenantId", "crmCompanyId") REFERENCES "crm_companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_tenantId_workCenterId_fkey" FOREIGN KEY ("tenantId", "workCenterId") REFERENCES "work_centers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_job_skill_requirements" ADD CONSTRAINT "service_job_skill_requirements_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "service_jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_job_skill_requirements" ADD CONSTRAINT "service_job_skill_requirements_tenantId_skillId_fkey" FOREIGN KEY ("tenantId", "skillId") REFERENCES "hr_skills"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_tenantId_partnerId_fkey" FOREIGN KEY ("tenantId", "partnerId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "service_projects"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoice_batches" ADD CONSTRAINT "service_invoice_batches_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "service_projects"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoice_batches" ADD CONSTRAINT "service_invoice_batches_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "customer_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_serviceTimeEntryId_fkey" FOREIGN KEY ("serviceTimeEntryId") REFERENCES "service_time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_servicePartUsageId_fkey" FOREIGN KEY ("servicePartUsageId") REFERENCES "service_part_usages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "service_jobs" ADD CONSTRAINT "service_job_planned_minutes" CHECK ("plannedMinutes" IS NULL OR ("plannedMinutes" >= 1 AND "plannedMinutes" <= 10080));
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "service_invoice_source_xor" CHECK (NOT ("serviceTimeEntryId" IS NOT NULL AND "servicePartUsageId" IS NOT NULL));

