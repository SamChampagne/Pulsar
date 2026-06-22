-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CustomFieldEntity" ADD VALUE 'RECEIPT';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'PICK_ORDER';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'YARD_VISIT';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'DOCK_APPOINTMENT';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'VEHICLE';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'TRAILER';
ALTER TYPE "CustomFieldEntity" ADD VALUE 'MAINTENANCE_ORDER';

-- AlterTable
ALTER TABLE "dock_appointments" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "maintenance_orders" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "trailers" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "wms_pick_orders" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "wms_receipts" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "yard_visits" ADD COLUMN     "customData" JSONB;
