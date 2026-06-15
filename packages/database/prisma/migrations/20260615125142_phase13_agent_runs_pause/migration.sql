-- CreateEnum
CREATE TYPE "AgentRunTrigger" AS ENUM ('EVENT', 'CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'KILLED');

-- AlterEnum
ALTER TYPE "AgentStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" "AgentRunTrigger" NOT NULL,
    "taskId" TEXT,
    "triggeredByRef" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "proposedActionCount" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_tenantId_agentId_createdAt_idx" ON "agent_runs"("tenantId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_tenantId_status_idx" ON "agent_runs"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
