-- CreateEnum
CREATE TYPE "EmailThreadStatus" AS ENUM ('UNLINKED', 'LINKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "direction" "EmailDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "inReplyTo" TEXT,
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "references" TEXT,
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "tenant_email_configs" ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapPasswordEnc" TEXT,
ADD COLUMN     "imapPort" INTEGER,
ADD COLUMN     "imapSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imapUsername" TEXT,
ADD COLUMN     "inboundActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastPollAt" TIMESTAMP(3),
ADD COLUMN     "lastPollOk" BOOLEAN;

-- CreateTable
CREATE TABLE "email_threads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectNorm" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "status" "EmailThreadStatus" NOT NULL DEFAULT 'UNLINKED',
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_threads_tenantId_status_lastMessageAt_idx" ON "email_threads"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "email_threads_tenantId_contactId_idx" ON "email_threads"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "email_threads_tenantId_dealId_idx" ON "email_threads"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_threadId_idx" ON "email_messages"("tenantId", "threadId");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_messageId_idx" ON "email_messages"("tenantId", "messageId");

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
