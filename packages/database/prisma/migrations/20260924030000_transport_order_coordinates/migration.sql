-- Optional commercial coordinates; never infer or backfill historical identities.
ALTER TABLE "transport_orders" ADD COLUMN "documentCoordinates" JSONB;
