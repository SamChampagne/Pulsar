-- Phase 8 fix: race-proof dedup for synthetic tracking events.
-- Additive DDL only: ADD COLUMN nullable + unique index.
-- Postgres allows multiple NULLs in a unique index, so ordinary events
-- (dedupKey = NULL) are unaffected. Only synthetic events (e.g. DELAYED)
-- set a non-null dedupKey to prevent duplicate creation under cron overlap.

-- AlterTable: tracking_events — add nullable dedupKey column
ALTER TABLE "tracking_events" ADD COLUMN "dedupKey" TEXT;

-- CreateIndex: unique index on dedupKey (NULLs are not considered duplicates in Postgres)
CREATE UNIQUE INDEX "tracking_events_dedupKey_key" ON "tracking_events"("dedupKey");
