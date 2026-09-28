-- Additive only: no reconstruction of historical catalog or order data.
CREATE TABLE "catalog_item_details" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "catalogItemId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0), "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_item_details_item_fk" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "catalog_item_details_tenantId_catalogItemId_key" ON "catalog_item_details"("tenantId", "catalogItemId");
CREATE TABLE "catalog_supplier_offers" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "catalogItemId" TEXT NOT NULL, "supplierId" TEXT NOT NULL,
  "supplierReference" TEXT NOT NULL, "currency" TEXT NOT NULL, "unitPrice" DECIMAL(16,4) NOT NULL CHECK ("unitPrice" >= 0),
  "minimumQuantity" DECIMAL(16,4) CHECK ("minimumQuantity" > 0), "orderMultiple" DECIMAL(16,4) CHECK ("orderMultiple" > 0),
  "leadTimeDays" INTEGER CHECK ("leadTimeDays" >= 0), "validFrom" DATE, "validUntil" DATE,
  "packaging" TEXT NOT NULL DEFAULT '', "terms" TEXT NOT NULL DEFAULT '', "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_supplier_offers_dates" CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" <= "validUntil"),
  CONSTRAINT "catalog_supplier_offers_item_fk" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "catalog_supplier_offers_supplier_fk" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "business_partners"("tenantId", "id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "catalog_supplier_offers_tenantId_id_key" ON "catalog_supplier_offers"("tenantId", "id");
CREATE UNIQUE INDEX "catalog_supplier_offers_tenantId_catalogItemId_supplierId_key" ON "catalog_supplier_offers"("tenantId", "catalogItemId", "supplierId");
ALTER TABLE "supplier_order_lines" ADD COLUMN "supplierTermsSnapshot" JSONB;
