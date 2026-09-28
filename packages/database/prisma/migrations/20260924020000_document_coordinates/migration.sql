-- Explicit opt-in snapshots only; do not invent historical coordinates.
ALTER TABLE "service_quotes" ADD COLUMN "documentCoordinates" JSONB;
ALTER TABLE "customer_invoices" ADD COLUMN "documentCoordinates" JSONB;
