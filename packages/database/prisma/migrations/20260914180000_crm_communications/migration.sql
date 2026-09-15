-- CreateEnum
CREATE TYPE "CrmSequenceMode" AS ENUM ('SIMULATION', 'GOVERNED');

-- CreateEnum
CREATE TYPE "CrmSequenceTrigger" AS ENUM ('MANUAL', 'CONTACT_CREATED');

-- CreateEnum
CREATE TYPE "CrmSequenceRunStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmSequenceStepStatus" AS ENUM ('PENDING', 'PROPOSED', 'QUEUED', 'SENT', 'SIMULATED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommunicationConsent" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED');

-- AlterTable
ALTER TABLE "crm_campaigns" ADD COLUMN     "enqueueFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recipientCount" INTEGER;

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "dedupKey" TEXT;

-- CreateTable
CREATE TABLE "crm_sequences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "CrmSequenceMode" NOT NULL DEFAULT 'SIMULATION',
    "trigger" "CrmSequenceTrigger" NOT NULL DEFAULT 'MANUAL',
    "agentId" TEXT,
    "steps" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sequence_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mode" "CrmSequenceMode" NOT NULL,
    "agentId" TEXT,
    "status" "CrmSequenceRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_sequence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sequence_step_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CrmSequenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "proposalId" TEXT,
    "emailId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_sequence_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_email_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "consent" "CommunicationConsent" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_email_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_sequences_tenantId_enabled_trigger_idx" ON "crm_sequences"("tenantId", "enabled", "trigger");

-- CreateIndex
CREATE INDEX "crm_sequence_runs_tenantId_status_idx" ON "crm_sequence_runs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "crm_sequence_runs_tenantId_contactId_idx" ON "crm_sequence_runs"("tenantId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sequence_runs_tenantId_sequenceId_contactId_key" ON "crm_sequence_runs"("tenantId", "sequenceId", "contactId");

-- CreateIndex
CREATE INDEX "crm_sequence_step_runs_tenantId_status_dueAt_idx" ON "crm_sequence_step_runs"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sequence_step_runs_tenantId_runId_position_key" ON "crm_sequence_step_runs"("tenantId", "runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_email_preferences_unsubscribeToken_key" ON "crm_email_preferences"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "crm_email_preferences_tenantId_email_key" ON "crm_email_preferences"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_tenantId_dedupKey_key" ON "email_messages"("tenantId", "dedupKey");

-- AddForeignKey
ALTER TABLE "crm_sequence_runs" ADD CONSTRAINT "crm_sequence_runs_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "crm_sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sequence_step_runs" ADD CONSTRAINT "crm_sequence_step_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "crm_sequence_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
