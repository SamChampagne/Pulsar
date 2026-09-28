CREATE TYPE "SmsStatus" AS ENUM ('SENDING', 'SIMULATED', 'ACCEPTED', 'REJECTED', 'UNKNOWN');
CREATE TABLE "tenant_sms_configs" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "apiKeyEnc" TEXT, "fromNumber" TEXT NOT NULL, "messagingProfileId" TEXT NOT NULL,
  "live" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT false,
  "dailyLimit" INTEGER NOT NULL DEFAULT 100 CHECK ("dailyLimit" BETWEEN 1 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_sms_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_sms_configs_tenantId_key" ON "tenant_sms_configs"("tenantId");
CREATE TABLE "sms_messages" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL, "toNumber" TEXT NOT NULL, "text" TEXT NOT NULL,
  "messagingProfileId" TEXT NOT NULL, "live" BOOLEAN NOT NULL, "configVersion" TIMESTAMP(3) NOT NULL,
  "status" "SmsStatus" NOT NULL DEFAULT 'SENDING', "providerMessageId" TEXT, "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sms_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sms_messages_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sms_messages_tenantId_operationKey_key" ON "sms_messages"("tenantId", "operationKey");
CREATE INDEX "sms_messages_tenantId_createdAt_id_idx" ON "sms_messages"("tenantId", "createdAt", "id");
