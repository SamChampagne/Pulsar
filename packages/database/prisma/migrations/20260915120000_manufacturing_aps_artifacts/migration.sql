ALTER TABLE "scheduling_runs"
  ADD COLUMN "inputRequest" JSONB,
  ADD COLUMN "engineResult" JSONB,
  ADD COLUMN "bridgeVersion" TEXT,
  ADD COLUMN "engineRevision" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "basedOnRunId" TEXT,
  ADD COLUMN "replayedFromId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publicationCheck" JSONB;

-- Do not silently select a winner if legacy data already contains duplicates.
-- Such a tenant must be reviewed before applying this migration.
CREATE UNIQUE INDEX "scheduling_runs_one_baseline_per_tenant"
  ON "scheduling_runs" ("tenantId") WHERE "isBaseline" = true;
