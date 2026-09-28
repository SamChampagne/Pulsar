CREATE TYPE "PartyDirectoryKind" AS ENUM ('ADDRESS', 'CONTACT');
CREATE TABLE "party_directory_entries" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "customerId" TEXT, "partnerId" TEXT, "kind" "PartyDirectoryKind" NOT NULL,
  "label" TEXT NOT NULL, "data" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "party_directory_one_owner" CHECK (num_nonnulls("customerId", "partnerId") = 1),
  CONSTRAINT "party_directory_positive_version" CHECK ("version" > 0),
  CONSTRAINT "party_directory_customer_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "party_directory_partner_fkey" FOREIGN KEY ("tenantId", "partnerId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "party_directory_entries_tenantId_id_key" ON "party_directory_entries"("tenantId", "id");
CREATE INDEX "party_directory_entries_tenantId_customerId_kind_idx" ON "party_directory_entries"("tenantId", "customerId", "kind");
CREATE INDEX "party_directory_entries_tenantId_partnerId_kind_idx" ON "party_directory_entries"("tenantId", "partnerId", "kind");
CREATE TABLE "party_directory_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "entryId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "party_directory_revision_entry_fkey" FOREIGN KEY ("tenantId", "entryId") REFERENCES "party_directory_entries"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "party_directory_revisions_tenantId_entryId_version_key" ON "party_directory_revisions"("tenantId", "entryId", "version");
CREATE UNIQUE INDEX "party_directory_revisions_tenantId_actorId_operationKey_key" ON "party_directory_revisions"("tenantId", "actorId", "operationKey");
