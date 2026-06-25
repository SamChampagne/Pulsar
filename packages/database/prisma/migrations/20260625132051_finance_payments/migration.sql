-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('RECEIVE', 'PAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentPartyType" AS ENUM ('CUSTOMER', 'CARRIER');

-- CreateEnum
CREATE TYPE "PaymentTargetType" AS ENUM ('CUSTOMER_INVOICE', 'CARRIER_INVOICE');

-- AlterTable
ALTER TABLE "customer_invoices" ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "modes_of_payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modes_of_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "partyType" "PaymentPartyType" NOT NULL,
    "partyId" TEXT NOT NULL,
    "modeOfPaymentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "targetType" "PaymentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modes_of_payment_tenantId_idx" ON "modes_of_payment"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "modes_of_payment_tenantId_name_key" ON "modes_of_payment"("tenantId", "name");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_idx" ON "payments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payments_tenantId_partyType_partyId_idx" ON "payments"("tenantId", "partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_paymentNumber_key" ON "payments"("tenantId", "paymentNumber");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_targetType_targetId_idx" ON "payment_allocations"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_paymentId_idx" ON "payment_allocations"("tenantId", "paymentId");

-- AddForeignKey
ALTER TABLE "modes_of_payment" ADD CONSTRAINT "modes_of_payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_modeOfPaymentId_fkey" FOREIGN KEY ("modeOfPaymentId") REFERENCES "modes_of_payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
