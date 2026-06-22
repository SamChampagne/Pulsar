-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "CustomFieldEntity" ADD VALUE 'INCOMING_CARRIER_INVOICE';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'CUSTOMER_INVOICE';

-- AlterTable
ALTER TABLE "customer_invoices" ADD COLUMN "customData" JSONB;

-- AlterTable
ALTER TABLE "incoming_carrier_invoices" ADD COLUMN "customData" JSONB;
