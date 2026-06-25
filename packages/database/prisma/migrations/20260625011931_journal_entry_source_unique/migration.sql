-- Drop the plain index and replace it with a unique index.
-- Postgres treats NULLs as distinct in a unique index, so MANUAL entries
-- (which have NULL sourceType/sourceId/sourceKind) are NOT deduped and still
-- post freely — only non-null auto-post tuples are enforced unique.

-- DropIndex (old plain index from billing_general_ledger migration)
DROP INDEX IF EXISTS "journal_entries_tenantId_sourceType_sourceId_sourceKind_idx";

-- CreateUniqueIndex
CREATE UNIQUE INDEX "journal_entries_tenantId_sourceType_sourceId_sourceKind_key" ON "journal_entries"("tenantId", "sourceType", "sourceId", "sourceKind");
