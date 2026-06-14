-- CreateTable
CREATE TABLE "agent_runtime_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "defaultModel" TEXT,
    "baseUrl" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runtime_configs_tenantId_key" ON "agent_runtime_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "agent_runtime_configs" ADD CONSTRAINT "agent_runtime_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
