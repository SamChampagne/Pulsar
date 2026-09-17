-- Stop rather than silently round an existing floating-point BOM value.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "bom_lines" WHERE "quantityPerUnit"::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Non-finite BOM quantities must be corrected before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM "bom_lines" WHERE "quantityPerUnit"::text::numeric != round("quantityPerUnit"::text::numeric,9)
    OR abs("quantityPerUnit"::text::numeric) >= 1000000000000000) THEN
    RAISE EXCEPTION 'BOM quantity exceeds Decimal(24,9); explicit correction required';
  END IF;
END $$;
ALTER TABLE "bom_lines" ALTER COLUMN "quantityPerUnit" TYPE DECIMAL(24,9) USING "quantityPerUnit"::text::numeric;
CREATE TABLE "bom_revisions" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bomId" TEXT NOT NULL REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0), "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "outputItemId" TEXT NOT NULL REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "outputSku" TEXT NOT NULL, "outputName" TEXT NOT NULL, "outputUnit" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bom_revisions_tenantId_bomId_revision_key" ON "bom_revisions"("tenantId","bomId","revision");
CREATE INDEX "bom_revisions_tenantId_outputItemId_idx" ON "bom_revisions"("tenantId","outputItemId");
CREATE TABLE "bom_revision_lines" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL REFERENCES "bom_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sku" TEXT NOT NULL, "name" TEXT NOT NULL, "unit" TEXT NOT NULL,
  "quantityPerUnit" DECIMAL(24,9) NOT NULL CHECK ("quantityPerUnit" > 0)
);
CREATE INDEX "bom_revision_lines_tenantId_revisionId_idx" ON "bom_revision_lines"("tenantId","revisionId");
CREATE INDEX "bom_revision_lines_tenantId_itemId_idx" ON "bom_revision_lines"("tenantId","itemId");
ALTER TABLE "mrp_item_policies" ADD COLUMN "bomRevisionId" TEXT REFERENCES "bom_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mrp_runs" ADD COLUMN "sourceMetadata" JSONB;
ALTER TABLE "manufacturing_orders"
  ADD COLUMN "locationId" TEXT REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "bomRevisionId" TEXT REFERENCES "bom_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "materialSnapshot" JSONB;
-- No backfill: old orders do not have a known historical industrial definition.
