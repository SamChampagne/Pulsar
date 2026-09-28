CREATE TYPE "LotDisposition" AS ENUM ('UNRESTRICTED', 'QUARANTINED');
ALTER TABLE "wms_lots"
 ADD COLUMN "disposition" "LotDisposition" NOT NULL DEFAULT 'UNRESTRICTED',
 ADD COLUMN "dispositionRevision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "dispositionReason" TEXT;
CREATE TABLE "wms_lot_decisions" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "itemId" TEXT NOT NULL,
 "lotId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL,
 "fromDisposition" "LotDisposition" NOT NULL,
 "toDisposition" "LotDisposition" NOT NULL,
 "reason" TEXT NOT NULL,
 "controlNote" TEXT,
 "operationKey" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "wms_lot_decisions_reason_check" CHECK (length(trim("reason")) BETWEEN 3 AND 1000),
 CONSTRAINT "wms_lot_decisions_transition_check" CHECK ("fromDisposition" <> "toDisposition" AND "revision" > 0),
 CONSTRAINT "wms_lot_decisions_control_check" CHECK ("toDisposition" <> 'UNRESTRICTED' OR ("controlNote" IS NOT NULL AND length(trim("controlNote")) BETWEEN 10 AND 2000)),
 CONSTRAINT "wms_lot_decisions_lot_fk" FOREIGN KEY ("tenantId", "itemId", "lotId") REFERENCES "wms_lots"("tenantId", "itemId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "wms_lot_decisions_actor_fk" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wms_lot_decisions_tenantId_operationKey_key" ON "wms_lot_decisions"("tenantId", "operationKey");
CREATE UNIQUE INDEX "wms_lot_decisions_tenantId_lotId_revision_key" ON "wms_lot_decisions"("tenantId", "lotId", "revision");
