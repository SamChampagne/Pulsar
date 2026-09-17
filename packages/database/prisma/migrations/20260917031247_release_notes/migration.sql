-- CreateEnum
CREATE TYPE "ReleaseNoteKind" AS ENUM ('FEATURE', 'IMPROVEMENT', 'FIX');

-- CreateEnum
CREATE TYPE "ReleaseNoteStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "releaseNotesSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "release_notes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" "ReleaseNoteKind" NOT NULL,
    "version" TEXT,
    "status" "ReleaseNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_notes_status_publishedAt_idx" ON "release_notes"("status", "publishedAt");
