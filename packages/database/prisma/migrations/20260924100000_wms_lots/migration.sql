ALTER TABLE "wms_items" ADD COLUMN "lotTracked" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "wms_lots" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "code" TEXT NOT NULL,
 "supplierLot" TEXT, "manufacturedOn" DATE, "expiresOn" DATE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "wms_lots_dates_check" CHECK ("expiresOn" IS NULL OR "manufacturedOn" IS NULL OR "expiresOn" >= "manufacturedOn"),
 CONSTRAINT "wms_lots_item_fk" FOREIGN KEY ("tenantId","itemId") REFERENCES "wms_items"("tenantId","id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "wms_lots_tenantId_itemId_id_key" ON "wms_lots"("tenantId","itemId","id");
CREATE UNIQUE INDEX "wms_lots_tenantId_itemId_code_key" ON "wms_lots"("tenantId","itemId","code");
CREATE INDEX "wms_lots_tenantId_expiresOn_idx" ON "wms_lots"("tenantId","expiresOn");
CREATE TABLE "wms_lot_balances" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "lotId" TEXT NOT NULL,
 "binId" TEXT NOT NULL, "qtyOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0 CHECK ("qtyOnHand" >= 0),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "wms_lot_balances_lot_fk" FOREIGN KEY ("tenantId","itemId","lotId") REFERENCES "wms_lots"("tenantId","itemId","id") ON UPDATE CASCADE ON DELETE RESTRICT,
 CONSTRAINT "wms_lot_balances_bin_fk" FOREIGN KEY ("tenantId","binId") REFERENCES "wms_bins"("tenantId","id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "wms_lot_balances_tenantId_lotId_binId_key" ON "wms_lot_balances"("tenantId","lotId","binId");
CREATE INDEX "wms_lot_balances_tenantId_itemId_binId_idx" ON "wms_lot_balances"("tenantId","itemId","binId");
ALTER TABLE "wms_stock_movements" ADD COLUMN "lotId" TEXT;
ALTER TABLE "wms_receipt_lines" ADD COLUMN "lotId" TEXT;
ALTER TABLE "wms_pick_lines" ADD COLUMN "lotId" TEXT;
ALTER TABLE "wms_stock_movements" ADD CONSTRAINT "wms_stock_movements_lot_fk" FOREIGN KEY ("tenantId","itemId","lotId") REFERENCES "wms_lots"("tenantId","itemId","id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "wms_receipt_lines" ADD CONSTRAINT "wms_receipt_lines_lot_fk" FOREIGN KEY ("tenantId","itemId","lotId") REFERENCES "wms_lots"("tenantId","itemId","id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "wms_pick_lines" ADD CONSTRAINT "wms_pick_lines_lot_fk" FOREIGN KEY ("tenantId","itemId","lotId") REFERENCES "wms_lots"("tenantId","itemId","id") ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX "wms_stock_movements_tenantId_lotId_createdAt_idx" ON "wms_stock_movements"("tenantId","lotId","createdAt");
