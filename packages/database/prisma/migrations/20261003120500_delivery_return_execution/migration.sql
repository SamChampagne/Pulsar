-- Preserve D1 execution evidence; physical returns keep their loading history.
-- Separate migration: RETURNED was introduced by the preceding enum migration.
ALTER TABLE "delivery_packages" DROP CONSTRAINT "delivery_packages_execution_check";
ALTER TABLE "delivery_packages" ADD CONSTRAINT "delivery_packages_execution_check" CHECK (
  ("status" IN ('PREPARED', 'CANCELLED') AND "loadedLoadId" IS NULL AND "loadedAt" IS NULL AND "deliveredAt" IS NULL)
  OR ("status" = 'LOADED' AND "loadedLoadId" IS NOT NULL AND "loadedAt" IS NOT NULL AND "deliveredAt" IS NULL)
  OR ("status" = 'DELIVERED' AND "loadedLoadId" IS NOT NULL AND "loadedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "deliveredAt" >= "loadedAt")
  OR ("status" = 'RETURNED' AND "loadedLoadId" IS NOT NULL AND "loadedAt" IS NOT NULL AND ("deliveredAt" IS NULL OR "deliveredAt" >= "loadedAt"))
);
