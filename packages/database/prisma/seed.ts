/**
 * Development seed.
 * Idempotent: safe to run multiple times (upserts everywhere).
 *
 * Creates:
 *  - the platform permission catalog and module catalog
 *  - a demo tenant "acme" with the transportation module enabled
 *  - an admin role (all permissions) and admin user admin@pulsar.dev / admin123
 *  - sample TMS master data and one transport order
 */
import { PrismaClient, TransportOrderStatus } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { MODULE_CATALOG, PERMISSION_CATALOG, MODULE_KEYS } from '@pulsar/shared';

const prisma = new PrismaClient();

async function main() {
  // --- Platform catalogs -----------------------------------------------------
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: { key: p.key, module: p.module, description: p.description },
    });
  }

  for (const m of MODULE_CATALOG) {
    await prisma.moduleDefinition.upsert({
      where: { key: m.key },
      update: { name: m.name, description: m.description, isCore: m.isCore, available: m.available },
      create: {
        key: m.key,
        name: m.name,
        description: m.description,
        isCore: m.isCore,
        available: m.available,
      },
    });
  }
  console.log(`Seeded ${PERMISSION_CATALOG.length} permissions, ${MODULE_CATALOG.length} modules.`);

  // --- Demo tenant -----------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { slug: 'acme', name: 'Acme Manufacturing', status: 'ACTIVE' },
  });

  for (const key of [MODULE_KEYS.CORE, MODULE_KEYS.TRANSPORTATION]) {
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId: tenant.id, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  }

  // --- Admin role + user -----------------------------------------------------
  const adminRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: 'admin',
      name: 'Administrator',
      description: 'Full access to all modules',
      isSystem: true,
    },
  });

  const allPermissions = await prisma.permission.findMany();
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: permission.id },
    });
  }

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@pulsar.dev' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@pulsar.dev',
      passwordHash: hashSync('admin123', 10),
      firstName: 'Admin',
      lastName: 'Pulsar',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });
  console.log(`Tenant "${tenant.slug}" ready — admin@pulsar.dev / admin123`);

  // --- Platform staff --------------------------------------------------------
  // A dedicated "platform" tenant hosts cross-tenant administrators. They wield
  // platform powers via the isPlatformAdmin flag (see /platform endpoints), not
  // through any business module, and keep a non-null tenantId like everyone else.
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: {},
    create: { slug: 'platform', name: 'Pulsar Platform', status: 'ACTIVE' },
  });
  const coreModule = await prisma.moduleDefinition.findUniqueOrThrow({
    where: { key: MODULE_KEYS.CORE },
  });
  await prisma.tenantModule.upsert({
    where: { tenantId_moduleId: { tenantId: platformTenant.id, moduleId: coreModule.id } },
    update: { enabled: true },
    create: {
      tenantId: platformTenant.id,
      moduleId: coreModule.id,
      enabled: true,
      enabledAt: new Date(),
    },
  });
  const platformRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: platformTenant.id, key: 'admin' } },
    update: {},
    create: {
      tenantId: platformTenant.id,
      key: 'admin',
      name: 'Administrator',
      description: 'Full access to all modules',
      isSystem: true,
    },
  });
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: platformRole.id, permissionId: permission.id },
    });
  }
  const platformAdmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'platform@pulsar.dev' } },
    update: { isPlatformAdmin: true },
    create: {
      tenantId: platformTenant.id,
      email: 'platform@pulsar.dev',
      passwordHash: hashSync('platform123', 10),
      firstName: 'Platform',
      lastName: 'Admin',
      status: 'ACTIVE',
      isPlatformAdmin: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: platformAdmin.id, roleId: platformRole.id } },
    update: {},
    create: { userId: platformAdmin.id, roleId: platformRole.id },
  });
  console.log('Platform admin ready — platform@pulsar.dev / platform123');

  // --- Sample TMS master data --------------------------------------------------
  const customer = await prisma.customer.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'CUST-001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'CUST-001',
      name: 'Northern Retail Group',
      contactName: 'Marie Tremblay',
      email: 'logistics@northernretail.example',
    },
  });

  const plant = await prisma.location.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'LOC-PLANT-01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'LOC-PLANT-01',
      name: 'Acme Plant — Québec',
      type: 'PLANT',
      addressLine1: '100 Rue Industrielle',
      city: 'Québec',
      state: 'QC',
      postalCode: 'G1K 0A1',
      country: 'CA',
    },
  });

  const dc = await prisma.location.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'LOC-DC-MTL' } },
    update: {},
    create: {
      tenantId: tenant.id,
      customerId: customer.id,
      code: 'LOC-DC-MTL',
      name: 'Northern Retail DC — Montréal',
      type: 'DISTRIBUTION_CENTER',
      addressLine1: '4500 Boulevard des Entrepôts',
      city: 'Montréal',
      state: 'QC',
      postalCode: 'H1B 5H3',
      country: 'CA',
    },
  });

  const carrier = await prisma.carrier.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'CARR-001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'CARR-001',
      name: 'TransExpress Québec',
      scacCode: 'TEQC',
      contactName: 'Jean Bouchard',
      email: 'dispatch@transexpress.example',
      phone: '+1-418-555-0101',
    },
  });

  await prisma.driver.createMany({
    data: [
      {
        tenantId: tenant.id,
        carrierId: carrier.id,
        firstName: 'Luc',
        lastName: 'Gagnon',
        phone: '+1-418-555-0144',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.vehicle.upsert({
    where: { tenantId_unitNumber: { tenantId: tenant.id, unitNumber: 'TRK-101' } },
    update: {},
    create: {
      tenantId: tenant.id,
      carrierId: carrier.id,
      unitNumber: 'TRK-101',
      type: 'TRACTOR',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2023,
    },
  });

  await prisma.trailer.upsert({
    where: { tenantId_unitNumber: { tenantId: tenant.id, unitNumber: 'TRL-201' } },
    update: {},
    create: {
      tenantId: tenant.id,
      carrierId: carrier.id,
      unitNumber: 'TRL-201',
      type: 'DRY_VAN',
      capacityWeightKg: 20000,
    },
  });

  await prisma.transportOrder.upsert({
    where: { tenantId_orderNumber: { tenantId: tenant.id, orderNumber: 'TO-000001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      orderNumber: 'TO-000001',
      customerId: customer.id,
      customerReference: 'PO-78231',
      status: TransportOrderStatus.DRAFT,
      originLocationId: plant.id,
      destinationLocationId: dc.id,
      requestedPickupDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      requestedDeliveryDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      totalWeightKg: 12500,
      palletCount: 22,
      createdById: admin.id,
    },
  });

  console.log('Sample TMS data ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
