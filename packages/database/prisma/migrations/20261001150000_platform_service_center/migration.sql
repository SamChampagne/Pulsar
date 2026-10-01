CREATE TABLE "platform_email_configs" (
  "id" TEXT NOT NULL DEFAULT 'smtp', "mode" TEXT NOT NULL DEFAULT 'SIMULATION',
  "host" TEXT, "port" INTEGER NOT NULL DEFAULT 587, "secure" BOOLEAN NOT NULL DEFAULT false,
  "username" TEXT, "passwordEnc" TEXT, "fromName" TEXT, "fromEmail" TEXT, "replyTo" TEXT,
  "lastTestAt" TIMESTAMP(3), "lastTestOk" BOOLEAN, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_email_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_email_configs_singleton" CHECK ("id" = 'smtp'),
  CONSTRAINT "platform_email_configs_mode" CHECK ("mode" IN ('ENVIRONMENT', 'SIMULATION', 'SMTP')),
  CONSTRAINT "platform_email_configs_port" CHECK ("port" BETWEEN 1 AND 65535)
);
CREATE TABLE "platform_service_audits" (
  "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "tenantId" TEXT,
  "service" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_service_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_service_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "platform_service_audits_createdAt_idx" ON "platform_service_audits"("createdAt");
-- No activation and no secret backfill. Environment behavior is preserved until an explicit change.
