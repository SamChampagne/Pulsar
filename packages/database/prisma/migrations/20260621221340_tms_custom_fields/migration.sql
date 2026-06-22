-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('TRANSPORT_ORDER', 'SHIPMENT', 'LOAD');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- AlterTable
ALTER TABLE "loads" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "customData" JSONB;

-- AlterTable
ALTER TABLE "transport_orders" ADD COLUMN     "customData" JSONB;

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_tenantId_module_entityType_idx" ON "custom_field_definitions"("tenantId", "module", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_tenantId_module_entityType_key_key" ON "custom_field_definitions"("tenantId", "module", "entityType", "key");
