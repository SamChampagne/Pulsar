-- CreateEnum
CREATE TYPE "CrmCompanyStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrmDealStage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK');

-- CreateTable
CREATE TABLE "crm_companies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "status" "CrmCompanyStatus" NOT NULL DEFAULT 'PROSPECT',
    "ownerUserId" TEXT,
    "customerId" TEXT,
    "carrierId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stage" "CrmDealStage" NOT NULL DEFAULT 'LEAD',
    "amount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "ownerUserId" TEXT,
    "expectedCloseDate" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "convertedCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "body" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_companies_tenantId_idx" ON "crm_companies"("tenantId");
CREATE INDEX "crm_companies_tenantId_status_idx" ON "crm_companies"("tenantId", "status");
CREATE INDEX "crm_contacts_tenantId_idx" ON "crm_contacts"("tenantId");
CREATE INDEX "crm_contacts_tenantId_companyId_idx" ON "crm_contacts"("tenantId", "companyId");
CREATE INDEX "crm_deals_tenantId_idx" ON "crm_deals"("tenantId");
CREATE INDEX "crm_deals_tenantId_stage_idx" ON "crm_deals"("tenantId", "stage");
CREATE INDEX "crm_deals_tenantId_lastActivityAt_idx" ON "crm_deals"("tenantId", "lastActivityAt");
CREATE INDEX "crm_activities_tenantId_idx" ON "crm_activities"("tenantId");
CREATE INDEX "crm_activities_tenantId_dealId_idx" ON "crm_activities"("tenantId", "dealId");
CREATE INDEX "crm_activities_tenantId_companyId_idx" ON "crm_activities"("tenantId", "companyId");
CREATE INDEX "crm_activities_tenantId_type_doneAt_idx" ON "crm_activities"("tenantId", "type", "doneAt");

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
