-- The same Telnyx sender/profile must not authenticate inbound events for two tenants.
-- Legacy configurations without a verification key remain untouched until configured in-app.
CREATE UNIQUE INDEX "tenant_sms_configs_verified_sender_key"
ON "tenant_sms_configs" ("messagingProfileId", "fromNumber") WHERE "webhookPublicKey" IS NOT NULL;
