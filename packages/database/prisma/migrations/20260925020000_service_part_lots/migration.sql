-- Legacy usages remain without a lot; never infer one from today's mapping or stock.
ALTER TABLE "service_part_usages" ADD COLUMN "lotId" TEXT;
ALTER TABLE "service_part_usages" ADD COLUMN "lotSnapshot" JSONB;
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_lot_fk"
  FOREIGN KEY ("tenantId", "wmsItemId", "lotId") REFERENCES "wms_lots"("tenantId", "itemId", "id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_lot_snapshot_check"
  CHECK (("lotId" IS NULL AND "lotSnapshot" IS NULL) OR
    ("lotId" IS NOT NULL AND "lotSnapshot" IS NOT NULL AND jsonb_typeof("lotSnapshot") = 'object'));
