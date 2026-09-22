CREATE TYPE "MrpSourcingMethod" AS ENUM ('BUY', 'MAKE');
CREATE TYPE "MrpEntryKind" AS ENUM ('DEMAND', 'SUPPLY');
CREATE TABLE "mrp_item_policies" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "locationId" TEXT NOT NULL REFERENCES "locations"("id"),
  "itemId" TEXT NOT NULL REFERENCES "wms_items"("id"),
  "method" "MrpSourcingMethod" NOT NULL DEFAULT 'BUY',
  "bomId" TEXT REFERENCES "boms"("id"), "unitSnapshot" TEXT NOT NULL,
  "leadDays" INTEGER NOT NULL DEFAULT 0 CHECK ("leadDays" BETWEEN 0 AND 3650),
  "safetyStock" DECIMAL(14,3) NOT NULL DEFAULT 0 CHECK ("safetyStock" >= 0),
  "minimumOrder" DECIMAL(14,3) NOT NULL DEFAULT 0 CHECK ("minimumOrder" >= 0),
  "orderMultiple" DECIMAL(14,3) NOT NULL DEFAULT 0.001 CHECK ("orderMultiple" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mrp_policy_method_bom" CHECK (("method" = 'MAKE' AND "bomId" IS NOT NULL) OR ("method" = 'BUY' AND "bomId" IS NULL))
);
CREATE UNIQUE INDEX "mrp_item_policies_tenantId_locationId_itemId_key" ON "mrp_item_policies"("tenantId","locationId","itemId");
CREATE INDEX "mrp_item_policies_tenantId_locationId_idx" ON "mrp_item_policies"("tenantId","locationId");
CREATE TABLE "mrp_entries" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "locationId" TEXT NOT NULL REFERENCES "locations"("id"), "itemId" TEXT NOT NULL REFERENCES "wms_items"("id"),
  "kind" "MrpEntryKind" NOT NULL, "quantity" DECIMAL(14,3) NOT NULL CHECK ("quantity" > 0),
  "unitSnapshot" TEXT NOT NULL, "dueDate" DATE NOT NULL, "reference" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "receiptId" TEXT REFERENCES "wms_receipts"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mrp_receipt_supply_only" CHECK ("receiptId" IS NULL OR "kind" = 'SUPPLY')
);
CREATE UNIQUE INDEX "mrp_entries_tenantId_receiptId_itemId_key" ON "mrp_entries"("tenantId","receiptId","itemId");
CREATE INDEX "mrp_entries_tenantId_locationId_isActive_dueDate_idx" ON "mrp_entries"("tenantId","locationId","isActive","dueDate");
CREATE TABLE "mrp_runs" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "locationId" TEXT NOT NULL REFERENCES "locations"("id"), "createdById" TEXT NOT NULL,
  "asOf" DATE NOT NULL, "horizonEnd" DATE NOT NULL, "sourceHash" TEXT NOT NULL,
  "inputSnapshot" JSONB NOT NULL, "result" JSONB NOT NULL,
  "proposalCount" INTEGER NOT NULL, "exceptionCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mrp_runs_tenantId_locationId_createdAt_idx" ON "mrp_runs"("tenantId","locationId","createdAt");
