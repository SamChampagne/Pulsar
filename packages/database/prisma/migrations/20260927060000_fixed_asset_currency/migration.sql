CREATE TYPE "FixedAssetOperationKind" AS ENUM ('CREATE','UPDATE','ACTIVATE','DEPRECIATE','RETIRE');
ALTER TABLE fixed_assets ADD COLUMN currency VARCHAR(3), ADD COLUMN "depreciationStartDate" DATE,
 ADD COLUMN "acquisitionReference" TEXT, ADD COLUMN version INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "planSnapshot" JSONB, ADD COLUMN "planHash" TEXT;
CREATE UNIQUE INDEX "fixed_assets_tenantId_id_key" ON fixed_assets("tenantId",id);
CREATE UNIQUE INDEX "journal_entries_tenantId_id_key" ON journal_entries("tenantId",id);
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_qualification_check CHECK (
 (currency IS NULL AND "depreciationStartDate" IS NULL AND version=0 AND "planSnapshot" IS NULL AND "planHash" IS NULL)
 OR (currency IS NOT NULL AND currency IN ('CAD','USD','EUR','MXN','GBP') AND "depreciationStartDate" IS NOT NULL
 AND version>0 AND cost>=0 AND "salvageValue">=0 AND "salvageValue"<=cost
 AND "accumulatedDepreciation">=0 AND "accumulatedDepreciation"<=cost-"salvageValue"
 AND "usefulLifeMonths" BETWEEN 1 AND 1200
 AND (("planSnapshot" IS NULL AND "planHash" IS NULL AND status!='ACTIVE') OR ("planSnapshot" IS NOT NULL AND "planHash" IS NOT NULL))));
ALTER TABLE depreciation_entries ADD COLUMN currency VARCHAR(3), ADD COLUMN ordinal INTEGER, ADD COLUMN "journalEntryId" TEXT;
CREATE UNIQUE INDEX "depreciation_entries_tenantId_journalEntryId_key" ON depreciation_entries("tenantId","journalEntryId");
ALTER TABLE depreciation_entries ADD CONSTRAINT "depreciation_entries_tenantId_journalEntryId_fkey"
 FOREIGN KEY("tenantId","journalEntryId") REFERENCES journal_entries("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE depreciation_entries ADD CONSTRAINT depreciation_entries_qualification_check CHECK(
 (currency IS NULL AND ordinal IS NULL AND "journalEntryId" IS NULL) OR
 (currency IS NOT NULL AND currency IN ('CAD','USD','EUR','MXN','GBP') AND ordinal>0 AND ordinal IS NOT NULL AND amount>=0 AND
 ((amount=0 AND "journalEntryId" IS NULL) OR (amount>0 AND "journalEntryId" IS NOT NULL))));
CREATE TABLE fixed_asset_operations (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "assetId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 kind "FixedAssetOperationKind" NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 "operationKey" UUID NOT NULL, fingerprint TEXT NOT NULL, result JSONB NOT NULL, reason TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fixed_asset_operations_tenantId_fkey" FOREIGN KEY("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT,
 CONSTRAINT "fixed_asset_operations_tenantId_assetId_fkey" FOREIGN KEY("tenantId","assetId") REFERENCES fixed_assets("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "fixed_asset_operations_tenantId_actorId_fkey" FOREIGN KEY("tenantId","actorId") REFERENCES users("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "fixed_asset_operations_tenantId_operationKey_key" ON fixed_asset_operations("tenantId","operationKey");
CREATE UNIQUE INDEX "fixed_asset_operations_tenantId_assetId_version_key" ON fixed_asset_operations("tenantId","assetId",version);
