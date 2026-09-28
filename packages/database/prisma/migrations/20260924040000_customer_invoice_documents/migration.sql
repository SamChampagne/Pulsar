-- Additive publication proof; never infer identities/files for historical invoices.
ALTER TABLE "customer_invoices"
  ADD COLUMN "documentSnapshot" JSONB,
  ADD COLUMN "publicationFingerprint" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedById" TEXT,
  ADD COLUMN "documentId" TEXT,
  ADD COLUMN "documentHash" TEXT;
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_tenantId_publishedById_fkey"
  FOREIGN KEY ("tenantId", "publishedById") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_tenantId_documentId_fkey"
  FOREIGN KEY ("tenantId", "documentId") REFERENCES "documents"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoice_publication_complete"
  CHECK (("documentSnapshot" IS NULL AND "publicationFingerprint" IS NULL AND "publishedAt" IS NULL AND "publishedById" IS NULL)
      OR ("documentSnapshot" IS NOT NULL AND "publicationFingerprint" IS NOT NULL AND "publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL AND "status" <> 'DRAFT'));
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoice_document_pair"
  CHECK (("documentId" IS NULL AND "documentHash" IS NULL)
      OR ("documentId" IS NOT NULL AND "documentHash" IS NOT NULL AND "documentSnapshot" IS NOT NULL));
