CREATE TYPE "SmsDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'UNCONFIRMED');
-- Never turn a previously server-blocked connection into a live connection on upgrade.
ALTER TABLE "tenant_sms_configs" ADD COLUMN "liveAuthorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "webhookPublicKey" TEXT, ADD COLUMN "webhookOrigin" TEXT, ADD COLUMN "lastWebhookAt" TIMESTAMP(3);
ALTER TABLE "tenant_email_configs" ADD COLUMN "inboundLive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sms_messages" ADD COLUMN "webhookUrl" TEXT,
  ADD COLUMN "deliveryStatus" "SmsDeliveryStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "deliveryAt" TIMESTAMP(3);
CREATE INDEX "sms_messages_tenantId_providerMessageId_idx" ON "sms_messages"("tenantId", "providerMessageId");
CREATE TABLE "sms_webhook_events" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "eventType" TEXT NOT NULL, "providerMessageId" TEXT NOT NULL,
  "messagingProfileId" TEXT NOT NULL, "fromNumber" TEXT NOT NULL, "toNumber" TEXT NOT NULL,
  "text" TEXT, "deliveryStatus" "SmsDeliveryStatus", "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_webhook_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sms_webhook_events_tenantId_eventId_key" ON "sms_webhook_events"("tenantId", "eventId");
CREATE INDEX "sms_webhook_events_tenantId_providerMessageId_idx" ON "sms_webhook_events"("tenantId", "providerMessageId");
CREATE INDEX "sms_webhook_events_tenantId_eventType_createdAt_id_idx" ON "sms_webhook_events"("tenantId", "eventType", "createdAt", "id");
CREATE TABLE "sms_suppressions" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "phoneNumber" TEXT NOT NULL, "sourceEventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_suppressions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sms_suppressions_tenantId_phoneNumber_key" ON "sms_suppressions"("tenantId", "phoneNumber");
CREATE INDEX "sms_suppressions_tenantId_createdAt_id_idx" ON "sms_suppressions"("tenantId", "createdAt", "id");
