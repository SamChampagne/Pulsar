-- Separate reference addresses; no guessing from old sites or historical documents.
ALTER TABLE "customers" ADD COLUMN "billingAddress" JSONB, ADD COLUMN "shippingAddress" JSONB;
ALTER TABLE "business_partners" ADD COLUMN "billingAddress" JSONB, ADD COLUMN "shippingAddress" JSONB;
