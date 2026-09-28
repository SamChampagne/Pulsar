-- No invented watermark or lot/unit backfill for historical documents.
ALTER TABLE "wms_cycle_counts" ADD COLUMN "stockMovementCount" INTEGER;
ALTER TABLE "wms_cycle_count_lines" ADD COLUMN "lotId" TEXT;
ALTER TABLE "wms_cycle_count_lines" ADD COLUMN "unitSnapshot" TEXT;
ALTER TABLE "wms_cycle_count_lines" ADD CONSTRAINT "wms_cycle_count_lines_lot_fk"
  FOREIGN KEY ("tenantId", "itemId", "lotId") REFERENCES "wms_lots"("tenantId", "itemId", "id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
-- Only new, captured documents are constrained; historical rows stay untouched.
CREATE UNIQUE INDEX "wms_count_captured_item_lot_key"
  ON "wms_cycle_count_lines"("tenantId", "cycleCountId", "itemId", "lotId")
  WHERE "unitSnapshot" IS NOT NULL AND "lotId" IS NOT NULL;
CREATE UNIQUE INDEX "wms_count_captured_item_key"
  ON "wms_cycle_count_lines"("tenantId", "cycleCountId", "itemId")
  WHERE "unitSnapshot" IS NOT NULL AND "lotId" IS NULL;
