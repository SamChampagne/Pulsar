CREATE UNIQUE INDEX "manufacturing_declarations_tenantId_id_key" ON "manufacturing_declarations"("tenantId", "id");
CREATE TABLE "manufacturing_declaration_reversals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "declarationId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manufacturing_reversal_reason_check" CHECK (length(trim("reason")) BETWEEN 3 AND 1000),
  CONSTRAINT "manufacturing_reversal_declaration_fkey" FOREIGN KEY ("tenantId", "declarationId") REFERENCES "manufacturing_declarations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "manufacturing_reversal_actor_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "manufacturing_declaration_reversals_tenantId_declarationId_key" ON "manufacturing_declaration_reversals"("tenantId", "declarationId");
CREATE UNIQUE INDEX "manufacturing_declaration_reversals_tenantId_operationKey_key" ON "manufacturing_declaration_reversals"("tenantId", "operationKey");
CREATE INDEX "manufacturing_declaration_reversals_tenantId_createdAt_idx" ON "manufacturing_declaration_reversals"("tenantId", "createdAt");
