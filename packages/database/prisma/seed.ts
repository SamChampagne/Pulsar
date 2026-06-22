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
import { MODULE_CATALOG, PERMISSION_CATALOG, LaneEndpointType, buildEndpointKey } from '@pulsar/shared';

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

  // Enable every available module on the demo tenant so the whole product surface
  // (Transport, Fleet, Yard, WMS, Billing, Analytics, Procurement, both portals)
  // is visible and reachable from the desk/nav out of the box.
  for (const descriptor of MODULE_CATALOG.filter((m) => m.available)) {
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: descriptor.key } });
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

  // --- Platform admin --------------------------------------------------------
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform@pulsar.dev';
  const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'admin123';
  await prisma.platformUser.upsert({
    where: { email: platformEmail },
    // Unlike the demo-data upserts, the hash follows PLATFORM_ADMIN_PASSWORD on
    // reseed: a rotated env password that silently kept the old hash would be a
    // security trap (review finding, phase 6B).
    update: { passwordHash: hashSync(platformPassword, 10) },
    create: {
      email: platformEmail,
      passwordHash: hashSync(platformPassword, 10),
      firstName: 'Platform',
      lastName: 'Admin',
      status: 'ACTIVE',
    },
  });
  console.log(`Platform admin ready — ${platformEmail}`);

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
      capacityPallets: 26,
    },
  });

  // --- Phase 7: rating master data -------------------------------------------------

  const accessorials = [
    { code: 'TAILGATE', name: 'Tailgate service', unit: 'FLAT' as const },
    { code: 'WAIT_HOUR', name: 'Waiting time (per hour)', unit: 'PER_HOUR' as const },
    { code: 'RESIDENTIAL', name: 'Residential delivery', unit: 'FLAT' as const },
  ];
  const accessorialRows = [] as { id: string; code: string }[];
  for (const a of accessorials) {
    const row = await prisma.accessorial.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: a.code } },
      update: {},
      create: { tenantId: tenant.id, ...a },
    });
    accessorialRows.push(row);
  }

  let fuelTable = await prisma.fuelSurchargeTable.findFirst({
    where: { tenantId: tenant.id, name: 'Standard diesel index' },
  });
  if (!fuelTable) {
    fuelTable = await prisma.fuelSurchargeTable.create({
      data: {
        tenantId: tenant.id,
        name: 'Standard diesel index',
        entries: {
          create: [
            { effectiveFrom: new Date('2026-01-01'), pct: 8 },
            { effectiveFrom: new Date('2026-06-01'), pct: 11.5 },
          ],
        },
      },
    });
  }

  // LOCATION→LOCATION lane (plant → dc) carrying the carrier preference list.
  const siteOriginKey = buildEndpointKey(LaneEndpointType.LOCATION, { locationId: plant.id });
  const siteDestinationKey = buildEndpointKey(LaneEndpointType.LOCATION, { locationId: dc.id });
  const siteLane = await prisma.lane.upsert({
    where: {
      tenantId_originKey_destinationKey: {
        tenantId: tenant.id,
        originKey: siteOriginKey,
        destinationKey: siteDestinationKey,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Plant → DC (site level)',
      originType: 'LOCATION',
      originLocationId: plant.id,
      destinationType: 'LOCATION',
      destinationLocationId: dc.id,
      originKey: siteOriginKey,
      destinationKey: siteDestinationKey,
    },
  });
  await prisma.laneCarrierPreference.upsert({
    where: {
      tenantId_laneId_carrierId: { tenantId: tenant.id, laneId: siteLane.id, carrierId: carrier.id },
    },
    update: { rank: 1 },
    create: { tenantId: tenant.id, laneId: siteLane.id, carrierId: carrier.id, rank: 1 },
  });

  // CITY→CITY lane derived from the same two locations (state/country fall back to QC/CA
  // when the seeded locations don't carry them).
  const cityOf = (loc: { city: string; state: string | null; country: string }) => ({
    city: loc.city,
    state: loc.state ?? 'QC',
    country: loc.country,
  });
  const cityOriginKey = buildEndpointKey(LaneEndpointType.CITY, cityOf(plant));
  const cityDestinationKey = buildEndpointKey(LaneEndpointType.CITY, cityOf(dc));
  const cityLane = await prisma.lane.upsert({
    where: {
      tenantId_originKey_destinationKey: {
        tenantId: tenant.id,
        originKey: cityOriginKey,
        destinationKey: cityDestinationKey,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: `${plant.city} → ${dc.city} (city level)`,
      originType: 'CITY',
      originCity: plant.city,
      originState: plant.state ?? 'QC',
      originCountry: plant.country,
      destinationType: 'CITY',
      destinationCity: dc.city,
      destinationState: dc.state ?? 'QC',
      destinationCountry: dc.country,
      originKey: cityOriginKey,
      destinationKey: cityDestinationKey,
    },
  });

  // A complete demo rate: CWT brackets + accessorial prices + dated fuel table, on the city lane.
  const demoRateName = 'Demo CWT grid (city lane)';
  const existingDemoRate = await prisma.rate.findFirst({
    where: { tenantId: tenant.id, name: demoRateName },
  });
  if (!existingDemoRate) {
    await prisma.rate.create({
      data: {
        tenantId: tenant.id,
        name: demoRateName,
        carrierId: carrier.id,
        laneId: cityLane.id,
        fuelTableId: fuelTable.id,
        rateType: 'PER_HUNDREDWEIGHT',
        baseAmount: 25,
        minCharge: 150,
        status: 'ACTIVE',
        breaks: {
          create: [
            { upToKg: 500, amount: 25 },
            { upToKg: 2000, amount: 18 },
            { upToKg: 10000, amount: 12 },
          ],
        },
        accessorialPrices: {
          create: [
            { accessorialId: accessorialRows[0].id, amount: 75 },
            { accessorialId: accessorialRows[1].id, amount: 60 },
          ],
        },
      },
    });
  }

  const customerRateName = 'Demo customer flat (city lane)';
  const existingCustomerRate = await prisma.rate.findFirst({
    where: { tenantId: tenant.id, name: customerRateName },
  });
  if (!existingCustomerRate) {
    await prisma.rate.create({
      data: {
        tenantId: tenant.id,
        name: customerRateName,
        customerId: customer.id,
        laneId: cityLane.id,
        rateType: 'FLAT',
        baseAmount: 1450,
        status: 'ACTIVE',
      },
    });
  }

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
      requestedPickupEarly: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      requestedPickupLate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      requestedDeliveryEarly: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      totalWeightKg: 12500,
      palletCount: 22,
      createdById: admin.id,
    },
  });

  // The sample order above bypasses SequencesService (hard rule 8): on a fresh
  // database the counter would still be at 0 and the FIRST API-created order
  // would also get TO-000001 — a unique-constraint crash that hit whichever
  // e2e suite ran first. Align the counter; never move an advanced one back.
  await prisma.numberSequence.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: 'transport-order' } },
    update: {},
    create: { tenantId: tenant.id, key: 'transport-order', value: 1 },
  });

  console.log('Sample TMS data ready.');

  // --- Built-in cross-module automation rules ------------------------------------
  // Phase 16: two reaction rules seeded for the demo tenant (idempotent: skip if
  // a rule with the same name already exists for this tenant).
  const autoPickRuleName = 'Auto-pick à la planification';
  const existingAutoPickRule = await prisma.automationRule.findFirst({
    where: { tenantId: tenant.id, name: autoPickRuleName },
  });
  if (!existingAutoPickRule) {
    await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: autoPickRuleName,
        eventType: 'transport-order.planned',
        enabled: true,
        match: 'ALL',
        conditions: [],
        action: { kind: 'RUN_ACTION', action: 'create_picks_for_order', args: { orderId: '{orderId}' } },
        createdById: admin.id,
      },
    });
  }

  const draftInvoiceRuleName = 'Relevé client à la livraison';
  const existingDraftInvoiceRule = await prisma.automationRule.findFirst({
    where: { tenantId: tenant.id, name: draftInvoiceRuleName },
  });
  if (!existingDraftInvoiceRule) {
    await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: draftInvoiceRuleName,
        eventType: 'load.completed',
        enabled: true,
        match: 'ALL',
        conditions: [],
        action: { kind: 'RUN_ACTION', action: 'draft_customer_invoice', args: { loadId: '{loadId}' } },
        createdById: admin.id,
      },
    });
  }

  console.log('Built-in automation rules ready.');

  // --- CRM demo data (acme tenant) -------------------------------------------
  // Two companies: one ACTIVE linked to the existing CUST-001 customer, one PROSPECT.
  const crmCompanyActive = await prisma.crmCompany.upsert({
    where: {
      // No natural unique key; use a stable name+tenant lookup pattern via findFirst then upsert by id trick.
      // Instead, we rely on a findFirst + create-or-skip pattern to stay idempotent.
      id: (
        (await prisma.crmCompany.findFirst({ where: { tenantId: tenant.id, name: 'Northern Retail Group' } })) ?? {
          id: 'crm-company-northern-retail',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-company-northern-retail',
      tenantId: tenant.id,
      name: 'Northern Retail Group',
      domain: 'northernretail.example',
      industry: 'Retail',
      status: 'ACTIVE',
      customerId: customer.id,
    },
  });

  const crmCompanyProspect = await prisma.crmCompany.upsert({
    where: {
      id: (
        (await prisma.crmCompany.findFirst({ where: { tenantId: tenant.id, name: 'Boréal Logistics Inc.' } })) ?? {
          id: 'crm-company-boreal-logistics',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-company-boreal-logistics',
      tenantId: tenant.id,
      name: 'Boréal Logistics Inc.',
      domain: 'boreal-logistics.example',
      industry: 'Third-Party Logistics',
      status: 'PROSPECT',
    },
  });

  // Two contacts
  await prisma.crmContact.upsert({
    where: {
      id: (
        (await prisma.crmContact.findFirst({ where: { tenantId: tenant.id, email: 'marie.tremblay@northernretail.example' } })) ?? {
          id: 'crm-contact-marie',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-contact-marie',
      tenantId: tenant.id,
      name: 'Marie Tremblay',
      companyId: crmCompanyActive.id,
      title: 'Logistics Manager',
      email: 'marie.tremblay@northernretail.example',
      phone: '+1-514-555-0200',
    },
  });

  await prisma.crmContact.upsert({
    where: {
      id: (
        (await prisma.crmContact.findFirst({ where: { tenantId: tenant.id, email: 'pierre.cote@boreal-logistics.example' } })) ?? {
          id: 'crm-contact-pierre',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-contact-pierre',
      tenantId: tenant.id,
      name: 'Pierre Côté',
      companyId: crmCompanyProspect.id,
      title: 'VP Operations',
      email: 'pierre.cote@boreal-logistics.example',
      phone: '+1-418-555-0333',
    },
  });

  // Three deals: one PROPOSAL stale (lastActivityAt 10 days ago), one QUALIFIED recent, one WON
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  const yesterday = new Date(Date.now() - 1 * 24 * 3600 * 1000);

  await prisma.crmDeal.upsert({
    where: {
      id: (
        (await prisma.crmDeal.findFirst({ where: { tenantId: tenant.id, title: 'Renouvellement contrat transport 2027' } })) ?? {
          id: 'crm-deal-renewal-stale',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-deal-renewal-stale',
      tenantId: tenant.id,
      title: 'Renouvellement contrat transport 2027',
      companyId: crmCompanyActive.id,
      stage: 'PROPOSAL',
      amount: 180000,
      currency: 'CAD',
      expectedCloseDate: new Date('2026-09-30'),
      lastActivityAt: tenDaysAgo,
    },
  });

  await prisma.crmDeal.upsert({
    where: {
      id: (
        (await prisma.crmDeal.findFirst({ where: { tenantId: tenant.id, title: 'Nouveau corridor Québec–Ontario' } })) ?? {
          id: 'crm-deal-qc-on-qualified',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-deal-qc-on-qualified',
      tenantId: tenant.id,
      title: 'Nouveau corridor Québec–Ontario',
      companyId: crmCompanyProspect.id,
      stage: 'QUALIFIED',
      amount: 95000,
      currency: 'CAD',
      expectedCloseDate: new Date('2026-10-15'),
      lastActivityAt: yesterday,
    },
  });

  await prisma.crmDeal.upsert({
    where: {
      id: (
        (await prisma.crmDeal.findFirst({ where: { tenantId: tenant.id, title: 'Contrat spot été 2026' } })) ?? {
          id: 'crm-deal-spot-won',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-deal-spot-won',
      tenantId: tenant.id,
      title: 'Contrat spot été 2026',
      companyId: crmCompanyActive.id,
      stage: 'WON',
      amount: 42000,
      currency: 'CAD',
      convertedCustomerId: customer.id,
      lastActivityAt: new Date('2026-06-01'),
    },
  });

  // One overdue TASK activity (dueAt in the past, doneAt null)
  await prisma.crmActivity.upsert({
    where: {
      id: (
        (await prisma.crmActivity.findFirst({ where: { tenantId: tenant.id, body: 'Envoyer la proposition de renouvellement révisée' } })) ?? {
          id: 'crm-activity-task-overdue',
        }
      ).id,
    },
    update: {},
    create: {
      id: 'crm-activity-task-overdue',
      tenantId: tenant.id,
      type: 'TASK',
      companyId: crmCompanyActive.id,
      dealId: 'crm-deal-renewal-stale',
      body: 'Envoyer la proposition de renouvellement révisée',
      dueAt: tenDaysAgo,
      doneAt: null,
      createdByUserId: admin.id,
    },
  });

  console.log('CRM demo data ready (2 companies, 2 contacts, 3 deals, 1 overdue task).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
