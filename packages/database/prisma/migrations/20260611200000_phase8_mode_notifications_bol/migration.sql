-- Phase 8: transport mode columns, tenant-wide notifications (nullable userId), BOL sequence.
-- Additive DDL only: ADD COLUMN defaults, DROP NOT NULL on notifications.userId — no data loss.

-- CreateEnum: TransportMode
CREATE TYPE "TransportMode" AS ENUM ('FTL', 'LTL', 'PARCEL');

-- AlterTable: transport_orders — add mode column with default FTL
ALTER TABLE "transport_orders" ADD COLUMN "mode" "TransportMode" NOT NULL DEFAULT 'FTL';

-- AlterTable: loads — add mode column with default FTL
ALTER TABLE "loads" ADD COLUMN "mode" "TransportMode" NOT NULL DEFAULT 'FTL';

-- AlterTable: rates — add nullable mode column (null = applies to all modes)
ALTER TABLE "rates" ADD COLUMN "mode" "TransportMode";

-- AlterTable: notifications — make userId nullable (null = tenant-wide notification)
ALTER TABLE "notifications" ALTER COLUMN "userId" DROP NOT NULL;
