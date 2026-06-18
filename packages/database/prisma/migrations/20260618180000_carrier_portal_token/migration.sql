-- AlterTable
ALTER TABLE "carriers" ADD COLUMN "portalToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "carriers_portalToken_key" ON "carriers"("portalToken");
