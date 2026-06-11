-- CreateEnum
CREATE TYPE "DisputeReasonCode" AS ENUM ('RATE_MISMATCH', 'QUANTITY_MISMATCH', 'UNEXPECTED_CHARGE', 'DUPLICATE_BILLING', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'PAID';

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "invoicedAmount" DECIMAL(12,2),
ADD COLUMN     "variance" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "carrierInvoiceNumber" TEXT,
ADD COLUMN     "disputeNote" TEXT,
ADD COLUMN     "disputeReasonCode" "DisputeReasonCode",
ADD COLUMN     "invoicedTotal" DECIMAL(12,2),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "varianceGross" DECIMAL(12,2),
ADD COLUMN     "varianceTotal" DECIMAL(12,2);
