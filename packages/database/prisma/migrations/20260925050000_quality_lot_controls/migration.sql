ALTER TABLE "quality_inspections"
 ADD COLUMN "lotItemId" TEXT,
 ADD COLUMN "lotId" TEXT,
 ADD COLUMN "lotSnapshot" JSONB,
 ADD COLUMN "lotDispositionRevision" INTEGER,
 ADD COLUMN "lotMovementCount" INTEGER;
ALTER TABLE "quality_inspections" DROP CONSTRAINT "quality_source_at_most_one";
ALTER TABLE "quality_inspections"
 ADD CONSTRAINT "quality_source_at_most_one" CHECK (num_nonnulls("receiptId", "manufacturingOrderId", "supportCaseId", "lotId") <= 1),
 ADD CONSTRAINT "quality_lot_context_check" CHECK (
   ("lotId" IS NULL AND "lotItemId" IS NULL AND "lotSnapshot" IS NULL AND "lotDispositionRevision" IS NULL AND "lotMovementCount" IS NULL)
   OR ("lotId" IS NOT NULL AND "lotItemId" IS NOT NULL AND "lotSnapshot" IS NOT NULL AND "lotDispositionRevision" IS NOT NULL AND "lotMovementCount" IS NOT NULL AND "lotDispositionRevision" >= 0 AND "lotMovementCount" >= 0)),
 ADD CONSTRAINT "quality_inspections_lot_fk" FOREIGN KEY ("tenantId", "lotItemId", "lotId") REFERENCES "wms_lots"("tenantId", "itemId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "quality_inspections_tenantId_lotId_status_idx" ON "quality_inspections"("tenantId", "lotId", "status");
ALTER TABLE "wms_lot_decisions" ADD COLUMN "qualityInspectionId" TEXT, ADD COLUMN "qualitySnapshot" JSONB;
ALTER TABLE "wms_lot_decisions"
 ADD CONSTRAINT "wms_lot_decisions_inspection_fk" FOREIGN KEY ("tenantId", "qualityInspectionId") REFERENCES "quality_inspections"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "wms_lot_decisions_inspection_check" CHECK (
   ("qualityInspectionId" IS NULL AND "qualitySnapshot" IS NULL) OR
   ("qualityInspectionId" IS NOT NULL AND "qualitySnapshot" IS NOT NULL AND "toDisposition" = 'UNRESTRICTED'));
