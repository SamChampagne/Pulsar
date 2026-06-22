-- AlterTable
ALTER TABLE "domain_events" ADD COLUMN     "reactionRuleId" TEXT;

-- CreateTable
CREATE TABLE "reaction_executions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reaction_executions_tenantId_createdAt_idx" ON "reaction_executions"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_executions_tenantId_eventId_ruleId_key" ON "reaction_executions"("tenantId", "eventId", "ruleId");
