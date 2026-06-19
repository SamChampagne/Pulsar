-- CreateTable
CREATE TABLE "shipment_comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_comments_tenantId_shipmentId_createdAt_idx" ON "shipment_comments"("tenantId", "shipmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "shipment_comments" ADD CONSTRAINT "shipment_comments_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
