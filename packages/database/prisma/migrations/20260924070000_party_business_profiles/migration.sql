CREATE TABLE "party_business_profiles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "partnerId" TEXT,
  "companyId" TEXT,
  "data" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "party_profile_owner_xor" CHECK (num_nonnulls("customerId", "partnerId", "companyId") = 1),
  CONSTRAINT "party_profile_customer_fk" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "party_profile_partner_fk" FOREIGN KEY ("tenantId", "partnerId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "party_profile_company_fk" FOREIGN KEY ("tenantId", "companyId") REFERENCES "crm_companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "party_business_profiles_tenantId_customerId_key" ON "party_business_profiles"("tenantId", "customerId");
CREATE UNIQUE INDEX "party_business_profiles_tenantId_partnerId_key" ON "party_business_profiles"("tenantId", "partnerId");
CREATE UNIQUE INDEX "party_business_profiles_tenantId_companyId_key" ON "party_business_profiles"("tenantId", "companyId");
