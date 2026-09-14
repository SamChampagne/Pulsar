CREATE TABLE "yard_dossier_links" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "visitId" TEXT,
  "appointmentId" TEXT,
  "loadId" TEXT,
  "receiptId" TEXT,
  "pickOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "yard_dossier_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "yard_dossier_links_one_source" CHECK (num_nonnulls("visitId", "appointmentId") = 1),
  CONSTRAINT "yard_dossier_links_one_target" CHECK (num_nonnulls("loadId", "receiptId", "pickOrderId") = 1)
);
CREATE INDEX "yard_dossier_links_tenantId_loadId_idx" ON "yard_dossier_links"("tenantId", "loadId");
CREATE INDEX "yard_dossier_links_tenantId_receiptId_idx" ON "yard_dossier_links"("tenantId", "receiptId");
CREATE INDEX "yard_dossier_links_tenantId_pickOrderId_idx" ON "yard_dossier_links"("tenantId", "pickOrderId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_visitId_loadId_key" ON "yard_dossier_links"("tenantId", "visitId", "loadId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_visitId_receiptId_key" ON "yard_dossier_links"("tenantId", "visitId", "receiptId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_visitId_pickOrderId_key" ON "yard_dossier_links"("tenantId", "visitId", "pickOrderId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_appointmentId_loadId_key" ON "yard_dossier_links"("tenantId", "appointmentId", "loadId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_appointmentId_receiptId_key" ON "yard_dossier_links"("tenantId", "appointmentId", "receiptId");
CREATE UNIQUE INDEX "yard_dossier_links_tenantId_appointmentId_pickOrderId_key" ON "yard_dossier_links"("tenantId", "appointmentId", "pickOrderId");
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "yard_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "dock_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "wms_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_dossier_links" ADD CONSTRAINT "yard_dossier_links_pickOrderId_fkey" FOREIGN KEY ("pickOrderId") REFERENCES "wms_pick_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
