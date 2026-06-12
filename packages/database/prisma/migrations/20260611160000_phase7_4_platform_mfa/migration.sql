-- Phase 7.4: platform user MFA columns (TOTP + recovery codes).
-- Three additive ADD COLUMNs — no destructive DDL, no data loss.

-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "platform_users" ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "platform_users" ADD COLUMN "recoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
