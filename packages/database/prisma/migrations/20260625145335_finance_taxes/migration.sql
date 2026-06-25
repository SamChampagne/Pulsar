-- CreateEnum
CREATE TYPE "TaxTemplateType" AS ENUM ('SALES', 'PURCHASE');

-- AlterTable
ALTER TABLE "customer_invoices" ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxDetail" JSONB,
ADD COLUMN     "taxTemplateId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxDetail" JSONB,
ADD COLUMN     "taxTemplateId" TEXT;

-- CreateTable
CREATE TABLE "tax_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxTemplateType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_template_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "accountCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tax_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_templates_tenantId_type_idx" ON "tax_templates"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tax_templates_tenantId_name_key" ON "tax_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tax_template_lines_tenantId_templateId_idx" ON "tax_template_lines"("tenantId", "templateId");

-- AddForeignKey
ALTER TABLE "tax_templates" ADD CONSTRAINT "tax_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_template_lines" ADD CONSTRAINT "tax_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "tax_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
