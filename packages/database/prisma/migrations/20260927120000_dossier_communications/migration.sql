CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'EMAIL');
CREATE TYPE "DossierEmailStatus" AS ENUM ('SENDING', 'SIMULATED', 'ACCEPTED', 'UNKNOWN');
CREATE UNIQUE INDEX "sms_messages_tenantId_id_key" ON "sms_messages"("tenantId", "id");

CREATE TABLE "dossier_communications" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "contextKind" TEXT NOT NULL, "contextId" TEXT NOT NULL, "contextLabel" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL, "recipient" TEXT NOT NULL,
  "subject" TEXT, "text" TEXT NOT NULL, "preferenceVersion" INTEGER NOT NULL,
  "smsMessageId" TEXT, "emailStatus" "DossierEmailStatus", "live" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dossier_communications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dossier_communications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "dossier_communications_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "dossier_communications_tenantId_smsMessageId_fkey" FOREIGN KEY ("tenantId", "smsMessageId") REFERENCES "sms_messages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "dossier_communications_channel_check" CHECK (("channel" = 'SMS' AND "smsMessageId" IS NOT NULL AND "emailStatus" IS NULL AND "subject" IS NULL) OR ("channel" = 'EMAIL' AND "smsMessageId" IS NULL AND "emailStatus" IS NOT NULL AND "subject" IS NOT NULL)),
  CONSTRAINT "dossier_communications_source_check" CHECK ("contextKind" IN ('customer','partner','crm-company','job','deal','shipment')),
  CONSTRAINT "dossier_communications_preference_check" CHECK ("preferenceVersion" > 0)
);
CREATE UNIQUE INDEX "dossier_communications_tenantId_operationKey_key" ON "dossier_communications"("tenantId", "operationKey");
CREATE UNIQUE INDEX "dossier_communications_smsMessageId_key" ON "dossier_communications"("smsMessageId");
CREATE UNIQUE INDEX "dossier_communications_tenantId_smsMessageId_key" ON "dossier_communications"("tenantId", "smsMessageId");
CREATE INDEX "dossier_communications_tenantId_contextKind_contextId_created_idx" ON "dossier_communications"("tenantId", "contextKind", "contextId", "createdAt", "id");

CREATE TABLE "communication_preferences" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "channel" "CommunicationChannel" NOT NULL,
  "recipient" TEXT NOT NULL, "allowed" BOOLEAN NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "communication_preferences_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "communication_preferences_tenantId_channel_recipient_key" ON "communication_preferences"("tenantId", "channel", "recipient");

CREATE TABLE "communication_templates" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "channel" "CommunicationChannel" NOT NULL,
  "name" TEXT NOT NULL, "subject" TEXT, "text" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "communication_templates_tenantId_channel_active_idx" ON "communication_templates"("tenantId", "channel", "active");
