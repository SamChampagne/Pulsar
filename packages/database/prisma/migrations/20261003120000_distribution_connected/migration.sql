-- CreateEnum
CREATE TYPE "DeliveryExceptionStatus" AS ENUM ('OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED', 'RETURN_RECEIVED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "DeliveryPackageStatus" ADD VALUE 'RETURNED';

-- CreateTable
CREATE TABLE "delivery_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "status" "DeliveryExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" VARCHAR(1000) NOT NULL,
    "retryAt" TIMESTAMP(3),
    "returnLocationId" TEXT,
    "receivedBy" VARCHAR(120),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_exception_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_exception_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fuel_profile_revisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_fuel_profile_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fuel_price_revisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_fuel_price_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fuel_actual_revisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_fuel_actual_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_delivery_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(300) NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "snapshotHash" VARCHAR(64) NOT NULL,
    "scopeHash" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "documentId" TEXT,
    "fileHash" VARCHAR(64),

    CONSTRAINT "driver_delivery_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_content_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "contentIndex" INTEGER NOT NULL,
    "sourceSalesOrderLineId" TEXT,
    "sourcePickLineId" TEXT,
    "quantity" DECIMAL(15,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,

    CONSTRAINT "delivery_content_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_allocation_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operationKey" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "allocationId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_allocation_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_exceptions_tenantId_loadId_status_idx" ON "delivery_exceptions"("tenantId", "loadId", "status");

-- CreateIndex
CREATE INDEX "delivery_exceptions_tenantId_packageId_idx" ON "delivery_exceptions"("tenantId", "packageId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_exceptions_tenantId_id_key" ON "delivery_exceptions"("tenantId", "id");

-- CreateIndex
CREATE INDEX "delivery_exception_events_tenantId_exceptionId_createdAt_idx" ON "delivery_exception_events"("tenantId", "exceptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_exception_events_tenantId_operationKey_key" ON "delivery_exception_events"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_profile_revisions_tenantId_vehicleId_revision_key" ON "delivery_fuel_profile_revisions"("tenantId", "vehicleId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_profile_revisions_tenantId_operationKey_key" ON "delivery_fuel_profile_revisions"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_price_revisions_tenantId_revision_key" ON "delivery_fuel_price_revisions"("tenantId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_price_revisions_tenantId_operationKey_key" ON "delivery_fuel_price_revisions"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_actual_revisions_tenantId_loadId_revision_key" ON "delivery_fuel_actual_revisions"("tenantId", "loadId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fuel_actual_revisions_tenantId_operationKey_key" ON "delivery_fuel_actual_revisions"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "driver_delivery_documents_tenantId_id_key" ON "driver_delivery_documents"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_delivery_documents_tenantId_loadId_revision_key" ON "driver_delivery_documents"("tenantId", "loadId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "driver_delivery_documents_tenantId_operationKey_key" ON "driver_delivery_documents"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "driver_delivery_documents_tenantId_number_key" ON "driver_delivery_documents"("tenantId", "number");

-- CreateIndex
CREATE INDEX "delivery_content_allocations_tenantId_packageId_idx" ON "delivery_content_allocations"("tenantId", "packageId");

-- CreateIndex
CREATE INDEX "delivery_content_allocations_tenantId_sourceSalesOrderLineI_idx" ON "delivery_content_allocations"("tenantId", "sourceSalesOrderLineId");

-- CreateIndex
CREATE INDEX "delivery_content_allocations_tenantId_sourcePickLineId_idx" ON "delivery_content_allocations"("tenantId", "sourcePickLineId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_content_allocations_tenantId_id_key" ON "delivery_content_allocations"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_allocation_operations_tenantId_operationKey_key" ON "delivery_allocation_operations"("tenantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenantId_id_key" ON "locations"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_line_items_tenantId_id_key" ON "sales_order_line_items"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_id_key" ON "vehicles"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wms_pick_lines_tenantId_id_key" ON "wms_pick_lines"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "delivery_exceptions" ADD CONSTRAINT "delivery_exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exceptions" ADD CONSTRAINT "delivery_exceptions_tenantId_packageId_fkey" FOREIGN KEY ("tenantId", "packageId") REFERENCES "delivery_packages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exceptions" ADD CONSTRAINT "delivery_exceptions_tenantId_loadId_fkey" FOREIGN KEY ("tenantId", "loadId") REFERENCES "loads"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exceptions" ADD CONSTRAINT "delivery_exceptions_tenantId_returnLocationId_fkey" FOREIGN KEY ("tenantId", "returnLocationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exception_events" ADD CONSTRAINT "delivery_exception_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exception_events" ADD CONSTRAINT "delivery_exception_events_tenantId_exceptionId_fkey" FOREIGN KEY ("tenantId", "exceptionId") REFERENCES "delivery_exceptions"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_exception_events" ADD CONSTRAINT "delivery_exception_events_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_profile_revisions" ADD CONSTRAINT "delivery_fuel_profile_revisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_profile_revisions" ADD CONSTRAINT "delivery_fuel_profile_revisions_tenantId_vehicleId_fkey" FOREIGN KEY ("tenantId", "vehicleId") REFERENCES "vehicles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_profile_revisions" ADD CONSTRAINT "delivery_fuel_profile_revisions_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_price_revisions" ADD CONSTRAINT "delivery_fuel_price_revisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_price_revisions" ADD CONSTRAINT "delivery_fuel_price_revisions_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_actual_revisions" ADD CONSTRAINT "delivery_fuel_actual_revisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_actual_revisions" ADD CONSTRAINT "delivery_fuel_actual_revisions_tenantId_loadId_fkey" FOREIGN KEY ("tenantId", "loadId") REFERENCES "loads"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fuel_actual_revisions" ADD CONSTRAINT "delivery_fuel_actual_revisions_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_documents" ADD CONSTRAINT "driver_delivery_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_documents" ADD CONSTRAINT "driver_delivery_documents_tenantId_loadId_fkey" FOREIGN KEY ("tenantId", "loadId") REFERENCES "loads"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_documents" ADD CONSTRAINT "driver_delivery_documents_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_documents" ADD CONSTRAINT "driver_delivery_documents_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_packageId_fkey" FOREIGN KEY ("tenantId", "packageId") REFERENCES "delivery_packages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_sourceSalesOrderLine_fkey" FOREIGN KEY ("tenantId", "sourceSalesOrderLineId") REFERENCES "sales_order_line_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_sourcePickLineId_fkey" FOREIGN KEY ("tenantId", "sourcePickLineId") REFERENCES "wms_pick_lines"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_content_allocations" ADD CONSTRAINT "delivery_content_allocations_tenantId_releasedById_fkey" FOREIGN KEY ("tenantId", "releasedById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_allocation_operations" ADD CONSTRAINT "delivery_allocation_operations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_allocation_operations" ADD CONSTRAINT "delivery_allocation_operations_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_allocation_operations" ADD CONSTRAINT "delivery_allocation_operations_tenantId_allocationId_fkey" FOREIGN KEY ("tenantId", "allocationId") REFERENCES "delivery_content_allocations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Persisted evidence is append-only. No "repair" of historical payloads is allowed.
CREATE FUNCTION delivery_batch_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Delivery evidence is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "delivery_exception_events_immutable" BEFORE UPDATE OR DELETE ON "delivery_exception_events" FOR EACH ROW EXECUTE FUNCTION delivery_batch_append_only();
CREATE TRIGGER "delivery_fuel_profile_revisions_immutable" BEFORE UPDATE OR DELETE ON "delivery_fuel_profile_revisions" FOR EACH ROW EXECUTE FUNCTION delivery_batch_append_only();
CREATE TRIGGER "delivery_fuel_price_revisions_immutable" BEFORE UPDATE OR DELETE ON "delivery_fuel_price_revisions" FOR EACH ROW EXECUTE FUNCTION delivery_batch_append_only();
CREATE TRIGGER "delivery_fuel_actual_revisions_immutable" BEFORE UPDATE OR DELETE ON "delivery_fuel_actual_revisions" FOR EACH ROW EXECUTE FUNCTION delivery_batch_append_only();
CREATE TRIGGER "delivery_allocation_operations_immutable" BEFORE UPDATE OR DELETE ON "delivery_allocation_operations" FOR EACH ROW EXECUTE FUNCTION delivery_batch_append_only();

CREATE UNIQUE INDEX delivery_exception_one_active ON delivery_exceptions ("tenantId","packageId") WHERE status IN ('OPEN','RETRY_PLANNED','RETURN_AUTHORIZED');
ALTER TABLE delivery_exceptions ADD CONSTRAINT delivery_exception_kind CHECK (kind IN ('DAMAGE','REFUSED','MISSING','ABSENT','OTHER'));
ALTER TABLE delivery_exceptions ADD CONSTRAINT delivery_exception_version CHECK (version > 0);
ALTER TABLE delivery_exceptions ADD CONSTRAINT delivery_exception_received CHECK (status <> 'RETURN_RECEIVED' OR ("receivedAt" IS NOT NULL AND "receivedBy" IS NOT NULL AND "returnLocationId" IS NOT NULL));

CREATE UNIQUE INDEX delivery_allocation_active_content ON delivery_content_allocations ("tenantId","packageId","contentIndex") WHERE "releasedAt" IS NULL;
ALTER TABLE delivery_content_allocations ADD CONSTRAINT delivery_allocation_source CHECK ("sourceSalesOrderLineId" IS NOT NULL OR "sourcePickLineId" IS NOT NULL);
ALTER TABLE delivery_content_allocations ADD CONSTRAINT delivery_allocation_positive CHECK (quantity > 0 AND "contentIndex" >= 0 AND "contentIndex" < 50);
ALTER TABLE delivery_content_allocations ADD CONSTRAINT delivery_allocation_release_pair CHECK (("releasedAt" IS NULL) = ("releasedById" IS NULL));
CREATE FUNCTION delivery_allocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Delivery allocation cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'releasedAt' - 'releasedById') IS DISTINCT FROM (to_jsonb(OLD) - 'releasedAt' - 'releasedById')
    OR (OLD."releasedAt" IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'Delivery allocation evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_allocation_immutable BEFORE UPDATE OR DELETE ON delivery_content_allocations FOR EACH ROW EXECUTE FUNCTION delivery_allocation_immutable();

ALTER TABLE driver_delivery_documents ADD CONSTRAINT driver_document_pair CHECK (("documentId" IS NULL) = ("fileHash" IS NULL));
CREATE FUNCTION driver_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Published driver document cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'documentId' - 'fileHash') IS DISTINCT FROM (to_jsonb(OLD) - 'documentId' - 'fileHash')
    OR (OLD."documentId" IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'Published driver document is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_document_immutable BEFORE UPDATE OR DELETE ON driver_delivery_documents FOR EACH ROW EXECUTE FUNCTION driver_document_immutable();
