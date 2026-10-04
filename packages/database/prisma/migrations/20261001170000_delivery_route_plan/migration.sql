ALTER TABLE "routes" ADD COLUMN "deliveryPlan" JSONB;
-- Legacy routes remain NULL: no invented fuel assumptions or historical backfill.
