-- CreateEnum
CREATE TYPE "OperationalTaskType" AS ENUM ('EXCEPTION');

-- CreateEnum
CREATE TYPE "OperationalTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TaskAssigneeType" AS ENUM ('UNASSIGNED', 'HUMAN', 'AGENT');

-- CreateEnum
CREATE TYPE "DomainEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "OperationalTaskType" NOT NULL,
    "category" TEXT NOT NULL,
    "status" "OperationalTaskStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "NotificationLevel" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "details" JSONB,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "assigneeType" "TaskAssigneeType" NOT NULL DEFAULT 'UNASSIGNED',
    "assigneeUserId" TEXT,
    "assigneeAgentId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "operational_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_events_status_createdAt_idx" ON "domain_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "domain_events_tenantId_type_createdAt_idx" ON "domain_events"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "operational_tasks_tenantId_status_assigneeType_idx" ON "operational_tasks"("tenantId", "status", "assigneeType");

-- CreateIndex
CREATE INDEX "operational_tasks_tenantId_assigneeAgentId_status_idx" ON "operational_tasks"("tenantId", "assigneeAgentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "operational_tasks_tenantId_dedupKey_key" ON "operational_tasks"("tenantId", "dedupKey");

