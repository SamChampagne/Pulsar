-- Additive only. Historical orders keep NULL; never reconstruct old commitments.
ALTER TABLE "supplier_orders" ADD COLUMN "documentCoordinates" JSONB;
