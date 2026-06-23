-- CreateEnum
CREATE TYPE "CrmCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- CreateTable
CREATE TABLE "crm_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_list_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "templateKey" TEXT,
    "status" "CrmCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_lists_tenantId_idx" ON "crm_lists"("tenantId");

-- CreateIndex
CREATE INDEX "crm_list_members_tenantId_listId_idx" ON "crm_list_members"("tenantId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_list_members_listId_contactId_key" ON "crm_list_members"("listId", "contactId");

-- CreateIndex
CREATE INDEX "crm_campaigns_tenantId_idx" ON "crm_campaigns"("tenantId");

-- CreateIndex
CREATE INDEX "crm_campaigns_tenantId_status_idx" ON "crm_campaigns"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "crm_lists" ADD CONSTRAINT "crm_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_list_members" ADD CONSTRAINT "crm_list_members_listId_fkey" FOREIGN KEY ("listId") REFERENCES "crm_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_listId_fkey" FOREIGN KEY ("listId") REFERENCES "crm_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
