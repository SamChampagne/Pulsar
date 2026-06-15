-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "breakerTrippedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "proposed_actions" ADD COLUMN     "autoApproved" BOOLEAN NOT NULL DEFAULT false;
