CREATE TYPE "AccountingTarget" AS ENUM ('NATIVE', 'EXTERNAL');
ALTER TABLE budgets ADD COLUMN currency VARCHAR(3), ADD COLUMN "periodFrom" DATE,
  ADD COLUMN "periodTo" DATE, ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "budgets_tenantId_id_key" ON budgets("tenantId",id);
ALTER TABLE budgets ADD CONSTRAINT budgets_qualification_check CHECK (
 (currency IS NULL AND "periodFrom" IS NULL AND "periodTo" IS NULL AND version=0) OR
 (currency IN ('CAD','USD','EUR','MXN','GBP') AND currency IS NOT NULL
 AND "periodFrom" IS NOT NULL AND "periodTo" IS NOT NULL AND "periodTo">="periodFrom"
 AND "periodTo"-"periodFrom"<366 AND EXTRACT(YEAR FROM "periodFrom")="fiscalYear" AND version>0));
CREATE TABLE accounting_profile_revisions (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0), target "AccountingTarget" NOT NULL,
 "targetCurrency" VARCHAR(3) NOT NULL CHECK("targetCurrency" IN ('CAD','USD','EUR','MXN','GBP')),
 "externalSystem" TEXT NOT NULL, reason TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "operationKey" UUID NOT NULL, fingerprint TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT accounting_profile_system_check CHECK((target='EXTERNAL' AND length(trim("externalSystem"))>0) OR (target='NATIVE' AND "externalSystem"='')),
 CONSTRAINT accounting_profile_actor_fk FOREIGN KEY("tenantId","actorId") REFERENCES users("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "accounting_profile_revisions_tenantId_version_key" ON accounting_profile_revisions("tenantId",version);
CREATE UNIQUE INDEX "accounting_profile_revisions_tenantId_operationKey_key" ON accounting_profile_revisions("tenantId","operationKey");
CREATE TABLE budget_revisions (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 "budgetId" TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), "actorId" TEXT NOT NULL,
 "operationKey" UUID NOT NULL, fingerprint TEXT NOT NULL, snapshot JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "budget_revisions_tenantId_budgetId_fkey" FOREIGN KEY("tenantId","budgetId") REFERENCES budgets("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT budget_revision_actor_fk FOREIGN KEY("tenantId","actorId") REFERENCES users("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "budget_revisions_tenantId_operationKey_key" ON budget_revisions("tenantId","operationKey");
CREATE UNIQUE INDEX "budget_revisions_tenantId_budgetId_version_key" ON budget_revisions("tenantId","budgetId",version);
