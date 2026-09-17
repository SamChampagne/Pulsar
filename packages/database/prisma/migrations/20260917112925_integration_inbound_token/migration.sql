-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "inbound_messages" ADD COLUMN     "dedupKey" TEXT;

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "inboundTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_tenantId_dedupKey_key" ON "inbound_messages"("tenantId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_inboundTokenHash_key" ON "integrations"("inboundTokenHash");
