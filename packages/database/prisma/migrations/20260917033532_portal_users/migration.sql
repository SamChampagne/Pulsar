-- CreateEnum
CREATE TYPE "PortalUserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "PortalUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PortalActionTokenKind" AS ENUM ('INVITATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "portal_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "PortalUserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "PortalUserStatus" NOT NULL DEFAULT 'INVITED',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_action_tokens" (
    "id" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "kind" "PortalActionTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_refresh_tokens" (
    "id" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_users_tenantId_customerId_idx" ON "portal_users"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_users_tenantId_email_key" ON "portal_users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_action_tokens_tokenHash_key" ON "portal_action_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_action_tokens_portalUserId_idx" ON "portal_action_tokens"("portalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_refresh_tokens_tokenHash_key" ON "portal_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_refresh_tokens_portalUserId_idx" ON "portal_refresh_tokens"("portalUserId");

-- AddForeignKey
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_action_tokens" ADD CONSTRAINT "portal_action_tokens_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_refresh_tokens" ADD CONSTRAINT "portal_refresh_tokens_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
