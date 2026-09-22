CREATE TYPE "MrpPreparationStatus" AS ENUM ('DRAFT', 'CANCELLED');
ALTER TABLE "bom_revisions" ADD COLUMN "valid_from" DATE, ADD COLUMN "valid_until" DATE;
ALTER TABLE "bom_revisions" ADD CONSTRAINT "bom_revision_valid_period" CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until);
ALTER TABLE "working_calendars" ADD COLUMN "location_id" TEXT;
ALTER TABLE "working_calendars" ADD CONSTRAINT "working_calendars_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "mrp_preparations" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "run_id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL, "operation_key" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL, "proposal_snapshot" JSONB NOT NULL, "number" TEXT NOT NULL,
  "method" "MrpSourcingMethod" NOT NULL, "status" "MrpPreparationStatus" NOT NULL DEFAULT 'DRAFT',
  "location_id" TEXT NOT NULL, "item_id" TEXT NOT NULL, "quantity" DECIMAL(14,3) NOT NULL,
  "unit_snapshot" TEXT NOT NULL, "release_date" DATE NOT NULL, "due_date" DATE NOT NULL,
  "manufacturing_order_id" TEXT, "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mrp_preparations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mrp_preparation_target" CHECK ((method = 'BUY' AND manufacturing_order_id IS NULL) OR (method = 'MAKE' AND manufacturing_order_id IS NOT NULL)),
  CONSTRAINT "mrp_preparation_quantity" CHECK (quantity > 0 AND quantity <= 1000000000),
  CONSTRAINT "mrp_preparation_dates" CHECK (release_date <= due_date)
);
CREATE UNIQUE INDEX "mrp_preparations_manufacturing_order_id_key" ON "mrp_preparations"("manufacturing_order_id");
CREATE INDEX "mrp_preparations_tenant_id_location_id_item_id_idx" ON "mrp_preparations"("tenant_id", "location_id", "item_id");
CREATE UNIQUE INDEX "mrp_preparations_tenant_id_run_id_proposal_id_key" ON "mrp_preparations"("tenant_id", "run_id", "proposal_id");
CREATE UNIQUE INDEX "mrp_preparations_tenant_id_operation_key_key" ON "mrp_preparations"("tenant_id", "operation_key");
CREATE UNIQUE INDEX "mrp_preparations_tenant_id_number_key" ON "mrp_preparations"("tenant_id", "number");
ALTER TABLE "mrp_preparations" ADD CONSTRAINT "mrp_preparations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mrp_preparations" ADD CONSTRAINT "mrp_preparations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mrp_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mrp_preparations" ADD CONSTRAINT "mrp_preparations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mrp_preparations" ADD CONSTRAINT "mrp_preparations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mrp_preparations" ADD CONSTRAINT "mrp_preparations_manufacturing_order_id_fkey" FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
