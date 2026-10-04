-- Additive: issued manifests have no inferred backfill from current shipment data.
CREATE TABLE "delivery_manifests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "loadId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "operationKey" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "manifestDocumentId" TEXT,
  "labelsDocumentId" TEXT,
  "manifestFileHash" VARCHAR(64),
  "labelsFileHash" VARCHAR(64),
  CONSTRAINT "delivery_manifests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_manifests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_manifests_tenantId_loadId_fkey" FOREIGN KEY ("tenantId", "loadId") REFERENCES "loads"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_manifests_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_manifests_tenantId_manifestDocumentId_fkey" FOREIGN KEY ("tenantId", "manifestDocumentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_manifests_tenantId_labelsDocumentId_fkey" FOREIGN KEY ("tenantId", "labelsDocumentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_manifests_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "delivery_manifests_number_check" CHECK (length(btrim("number")) BETWEEN 1 AND 80),
  CONSTRAINT "delivery_manifests_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 300),
  CONSTRAINT "delivery_manifests_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "delivery_manifests_source_hash_check" CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "delivery_manifests_snapshot_hash_check" CHECK ("snapshotHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "delivery_manifests_operation_key_check" CHECK ("operationKey"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "delivery_manifests_manifest_file_check" CHECK (("manifestDocumentId" IS NULL AND "manifestFileHash" IS NULL) OR ("manifestDocumentId" IS NOT NULL AND "manifestFileHash" IS NOT NULL AND "manifestFileHash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "delivery_manifests_labels_file_check" CHECK (("labelsDocumentId" IS NULL AND "labelsFileHash" IS NULL) OR ("labelsDocumentId" IS NOT NULL AND "labelsFileHash" IS NOT NULL AND "labelsFileHash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "delivery_manifests_snapshot_check" CHECK ((jsonb_typeof("snapshot") = 'object' AND "snapshot" -> 'schemaVersion' = '1'::jsonb) IS TRUE)
);
CREATE UNIQUE INDEX "delivery_manifests_tenantId_loadId_revision_key" ON "delivery_manifests"("tenantId", "loadId", "revision");
CREATE UNIQUE INDEX "delivery_manifests_tenantId_operationKey_key" ON "delivery_manifests"("tenantId", "operationKey");
CREATE UNIQUE INDEX "delivery_manifests_tenantId_number_key" ON "delivery_manifests"("tenantId", "number");
CREATE INDEX "delivery_manifests_tenantId_loadId_issuedAt_idx" ON "delivery_manifests"("tenantId", "loadId", "issuedAt");

-- Only the first binding of each canonical file is mutable. All issued business data stays frozen.
CREATE FUNCTION "guard_delivery_manifest_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['manifestDocumentId', 'labelsDocumentId', 'manifestFileHash', 'labelsFileHash'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['manifestDocumentId', 'labelsDocumentId', 'manifestFileHash', 'labelsFileHash']) THEN
    RAISE EXCEPTION 'Issued delivery manifest data is immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD."manifestDocumentId" IS NOT NULL AND (NEW."manifestDocumentId" IS DISTINCT FROM OLD."manifestDocumentId" OR NEW."manifestFileHash" IS DISTINCT FROM OLD."manifestFileHash"))
     OR (OLD."labelsDocumentId" IS NOT NULL AND (NEW."labelsDocumentId" IS DISTINCT FROM OLD."labelsDocumentId" OR NEW."labelsFileHash" IS DISTINCT FROM OLD."labelsFileHash")) THEN
    RAISE EXCEPTION 'Delivery manifest files can only be bound once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "delivery_manifests_immutable_update" BEFORE UPDATE ON "delivery_manifests"
FOR EACH ROW EXECUTE FUNCTION "guard_delivery_manifest_update"();
