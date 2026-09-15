-- AlterEnum
ALTER TYPE "CrmSequenceTrigger" ADD VALUE 'DEAL_STAGE_ENTERED';

-- DropIndex
DROP INDEX "crm_sequence_runs_tenantId_sequenceId_contactId_key";

-- AlterTable
ALTER TABLE "crm_deals" ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "pipelineStageId" TEXT,
ADD COLUMN     "primaryContactId" TEXT,
ADD COLUMN     "stageRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "crm_sequence_runs" ADD COLUMN     "dealId" TEXT,
ADD COLUMN     "enrollmentKey" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "pipelineStageId" TEXT,
ADD COLUMN     "stageRevision" INTEGER;

-- AlterTable
ALTER TABLE "crm_sequences" ADD COLUMN     "pipelineStageId" TEXT;

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmDealStage" NOT NULL,
    "position" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_stage_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "contactId" TEXT,
    "sequenceId" TEXT,
    "sequenceSnapshot" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "reason" TEXT,
    "runId" TEXT,

    CONSTRAINT "crm_stage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_pipelines_tenantId_idx" ON "crm_pipelines"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_tenantId_key_key" ON "crm_pipelines"("tenantId", "key");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_tenantId_pipelineId_archived_position_idx" ON "crm_pipeline_stages"("tenantId", "pipelineId", "archived", "position");

-- CreateIndex
CREATE INDEX "crm_stage_entries_processedAt_createdAt_idx" ON "crm_stage_entries"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "crm_stage_entries_tenantId_dealId_createdAt_idx" ON "crm_stage_entries"("tenantId", "dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_stage_entries_tenantId_dealId_revision_key" ON "crm_stage_entries"("tenantId", "dealId", "revision");

-- CreateIndex
CREATE INDEX "crm_deals_tenantId_pipelineId_pipelineStageId_idx" ON "crm_deals"("tenantId", "pipelineId", "pipelineStageId");

-- CreateIndex
CREATE INDEX "crm_sequence_runs_tenantId_dealId_idx" ON "crm_sequence_runs"("tenantId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sequence_runs_tenantId_sequenceId_contactId_enrollmentK_key" ON "crm_sequence_runs"("tenantId", "sequenceId", "contactId", "enrollmentKey");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sequences_pipelineStageId_key" ON "crm_sequences"("pipelineStageId");

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
