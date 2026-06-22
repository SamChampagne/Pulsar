-- AlterEnum
ALTER TYPE "CustomFieldEntity" ADD VALUE 'RFP';

-- AlterTable
ALTER TABLE "rfps" ADD COLUMN     "customData" JSONB;
