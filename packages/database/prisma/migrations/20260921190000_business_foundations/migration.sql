-- CreateEnum
CREATE TYPE "CatalogItemKind" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "ServiceProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceJobStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "business_partners" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CatalogItemKind" NOT NULL,
    "unit" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_projects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "partnerId" TEXT NOT NULL,
    "status" "ServiceProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "assigneeLabel" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3),
    "status" "ServiceJobStatus" NOT NULL DEFAULT 'PLANNED',
    "report" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "expectedDate" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unitPrice" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "supplier_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_tenantId_code_key" ON "business_partners"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_tenantId_id_key" ON "business_partners"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenantId_code_key" ON "catalog_items"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenantId_id_key" ON "catalog_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "service_projects_tenantId_status_idx" ON "service_projects"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_projects_tenantId_number_key" ON "service_projects"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "service_projects_tenantId_id_key" ON "service_projects"("tenantId", "id");

-- CreateIndex
CREATE INDEX "service_jobs_tenantId_projectId_status_idx" ON "service_jobs"("tenantId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_jobs_tenantId_number_key" ON "service_jobs"("tenantId", "number");

-- CreateIndex
CREATE INDEX "supplier_orders_tenantId_status_idx" ON "supplier_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_tenantId_number_key" ON "supplier_orders"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_tenantId_id_key" ON "supplier_orders"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_order_lines_tenantId_orderId_position_key" ON "supplier_order_lines"("tenantId", "orderId", "position");

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_tenantId_partnerId_fkey" FOREIGN KEY ("tenantId", "partnerId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "service_projects"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "business_partners"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "supplier_orders"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "catalog_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Register applications without enabling them on existing tenants.
INSERT INTO module_definitions (id, key, name, description, "isCore", available)
VALUES
 ('module-catalog', 'catalog', 'Catalogue commun', 'Produits, prestations et partenaires partagés.', false, true),
 ('module-purchasing', 'purchasing', 'Achats fournisseurs', 'Commandes fournisseurs, sans effet de stock automatique.', false, true),
 ('module-services', 'services', 'Services', 'Projets et interventions clients.', false, true)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE supplier_order_lines ADD CONSTRAINT supplier_line_quantity_positive CHECK (quantity > 0);
ALTER TABLE supplier_order_lines ADD CONSTRAINT supplier_line_price_nonnegative CHECK ("unitPrice" >= 0);
ALTER TABLE business_partners ADD CONSTRAINT partner_has_role CHECK ("isCustomer" OR "isSupplier");
