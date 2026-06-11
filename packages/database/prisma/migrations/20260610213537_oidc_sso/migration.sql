-- AlterEnum
ALTER TYPE "UserActionTokenKind" ADD VALUE 'OIDC_EXCHANGE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "authConfig" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "oidcSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_oidcSubject_key" ON "users"("tenantId", "oidcSubject");
