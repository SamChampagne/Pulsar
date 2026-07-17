-- Backfill the frozen offer snapshot for tenders created before the snapshot column
-- existed. Idempotent (only touches rows still NULL); prod deploys with in-flight
-- tenders keep showing the carrier the load's estimated cost as it was, instead of null.
UPDATE "tenders" t
SET "offeredAmount" = l."estimatedCost",
    "offeredCurrency" = l."costCurrency"
FROM "loads" l
WHERE t."loadId" = l."id"
  AND t."offeredAmount" IS NULL;
