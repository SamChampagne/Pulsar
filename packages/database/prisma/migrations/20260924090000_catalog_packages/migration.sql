CREATE TABLE "catalog_packages" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "catalogItemId" TEXT NOT NULL,
  "code" TEXT NOT NULL, "label" TEXT NOT NULL, "barcode" TEXT,
  "unitsPerPackage" DECIMAL(16,6) NOT NULL CHECK ("unitsPerPackage" > 0),
  "wholeOnly" BOOLEAN NOT NULL DEFAULT true, "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_packages_item_fk" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "catalog_packages_tenantId_id_key" ON "catalog_packages"("tenantId", "id");
CREATE UNIQUE INDEX "catalog_packages_tenantId_catalogItemId_code_key" ON "catalog_packages"("tenantId", "catalogItemId", "code");
CREATE UNIQUE INDEX "catalog_packages_tenantId_barcode_key" ON "catalog_packages"("tenantId", "barcode");
ALTER TABLE "supplier_order_lines" ADD COLUMN "packageSnapshot" JSONB;
ALTER TABLE "supplier_receipt_lines" ADD COLUMN "packageCount" DECIMAL(16,4) CHECK ("packageCount" > 0);
