import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import {
  MODULE_CATALOG,
  PERMISSION_CATALOG,
  REFERENCE_ACCESS,
  type ReferenceKind,
  VehicleType,
  TrailerType,
} from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Module autonomy — real guards and database, no TMS/Catalogue entitlement', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const tenants: Record<string, { id: string; token: string; reader: string; userId: string }> = {};
  const records: Record<string, any> = {};
  const slug = `autonomy-${Date.now()}`;
  async function actor(tenantId: string, tenant: string, key: string, keys: string[]) {
    const ps = await db.permission.findMany({ where: { key: { in: keys } } });
    const role = await db.role.create({
      data: {
        tenantId,
        key,
        name: key,
        permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
      },
    });
    const email = `${key}@${tenant}.test`;
    const user = await db.user.create({
      data: {
        tenantId,
        email,
        firstName: key,
        lastName: 'Autonomy',
        status: 'ACTIVE',
        passwordHash: hashSync('Test1234!', 4),
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ tenant, email, password: 'Test1234!' })
      .expect(200);
    return { token: login.body.accessToken as string, userId: user.id };
  }
  const call = (
    module: string,
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    body?: object,
    reader = false,
  ) =>
    request(http)
      [method]('/api/v1/' + path)
      .set('Authorization', `Bearer ${reader ? tenants[module].reader : tenants[module].token}`)
      .send(body);
  const payload = (kind: ReferenceKind) => {
    const code = randomUUID().slice(0, 12);
    if (kind === 'vehicle') return { unitNumber: code, type: VehicleType.TRACTOR };
    if (kind === 'trailer') return { unitNumber: code, type: TrailerType.DRY_VAN };
    if (kind === 'driver') return { firstName: 'Camille', lastName: code, phone: '5145550101' };
    if (kind === 'item') return { code, name: 'Inspection', kind: 'SERVICE', unit: 'H' };
    return { code, name: 'Référence autonome', phone: '5145550101' };
  };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ channel: 'log', send: jest.fn(async () => true) })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    db = app.get(PrismaService);
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (const module of [
      ...new Set([...REFERENCE_ACCESS.map((a) => a.module), 'transportation']),
    ]) {
      const tenant = `${slug}-${module}`;
      const row = await db.tenant.create({ data: { slug: tenant, name: tenant } });
      const entry = MODULE_CATALOG.find((m) => m.key === module)!;
      const definition = await db.moduleDefinition.upsert({
        where: { key: module },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({
        data: { tenantId: row.id, moduleId: definition.id, enabled: true },
      });
      const manager = await actor(
        row.id,
        tenant,
        'manager',
        PERMISSION_CATALOG.filter(
          (p) =>
            p.key.startsWith(`${module}.`) ||
            (module === 'transportation' && p.key.startsWith('core.locations.')),
        ).map((p) => p.key),
      );
      const reader = await actor(row.id, tenant, 'reader', [
        ...(module === 'transportation'
          ? ['transportation.orders.read', 'transportation.master-data.read']
          : []),
        ...new Set(REFERENCE_ACCESS.filter((a) => a.module === module).map((a) => a.read)),
      ]);
      tenants[module] = { id: row.id, ...manager, reader: reader.token };
    }
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });

  it.each(REFERENCE_ACCESS)(
    '$path: create, search, read, edit and audit with only $module',
    async (access) => {
      const created = (
        await call(access.module, 'post', access.path, payload(access.kind)).expect(201)
      ).body;
      records[access.path] = created;
      expect(created.id).toBeTruthy();
      const list = (await call(access.module, 'get', access.path).expect(200)).body;
      expect(list.items.some((r: any) => r.id === created.id)).toBe(true);
      const get = (await call(access.module, 'get', `${access.path}/${created.id}`).expect(200))
        .body;
      expect(get).not.toHaveProperty('tenantId');
      expect(get).not.toHaveProperty('vehicles');
      expect(get).not.toHaveProperty('locations');
      const change =
        access.kind === 'vehicle' || access.kind === 'trailer'
          ? { plate: 'AUTONOME' }
          : access.kind === 'driver'
            ? { firstName: 'Alex' }
            : { name: 'Modifié dans le module' };
      if (['client', 'supplier', 'item'].includes(access.kind))
        Object.assign(change, { expectedUpdatedAt: created.updatedAt });
      const updated = (
        await call(access.module, 'patch', `${access.path}/${created.id}`, change).expect(200)
      ).body;
      records[access.path] = updated;
      expect(updated.id).toBe(created.id);
      if (['customer', 'carrier', 'driver', 'client', 'supplier'].includes(access.kind)) {
        const cleared = (
          await call(access.module, 'patch', `${access.path}/${created.id}`, {
            phone: null,
            ...(['client', 'supplier'].includes(access.kind)
              ? { expectedUpdatedAt: updated.updatedAt }
              : {}),
          }).expect(200)
        ).body;
        expect(cleared.phone).toBeNull();
        records[access.path] = cleared;
      }
      await call(access.module, 'post', access.path, payload(access.kind), true).expect(403);
      await call(access.module, 'patch', `${access.path}/${created.id}`, change, true).expect(403);
      await call(access.module, 'get', access.path, undefined, true).expect(200);
      // Body spoofing and invalid shapes must go through the factory's explicit DTO pipe.
      await call(access.module, 'post', access.path, {
        ...payload(access.kind),
        tenantId: tenants.billing.id,
      }).expect(400);
      await call(access.module, 'post', access.path, {}).expect(400);
      await call(
        access.module,
        'get',
        access.kind === 'client' || access.kind === 'supplier' || access.kind === 'item'
          ? 'catalog/partners'
          : 'transportation/customers',
      ).expect(403);
      expect(
        await db.auditLog.count({
          where: {
            tenantId: tenants[access.module].id,
            entityId: created.id,
            userId: tenants[access.module].userId,
          },
        }),
      ).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(['services', 'billing'] as const)(
    '%s alone: select current coordinates, freeze with workflow, preserve history',
    async (module) => {
      const parent = (
        await call(
          module,
          'post',
          `${module}/data/customers`,
          payload(module === 'services' ? 'client' : 'customer'),
        ).expect(201)
      ).body;
      const directoryPath = `${module}/data/customers/${parent.id}/directory`;
      const entryBody = {
        ...directoryData('Contact du dossier'),
        validFrom: null,
        validUntil: null,
      };
      const entry = (
        await call(module, 'post', directoryPath, {
          operationKey: randomUUID(),
          reason: 'Contact métier',
          entry: entryBody,
        }).expect(201)
      ).body;
      let doc: any;
      let path: string;
      if (module === 'services') {
        const item = records['services/data/items'];
        doc = (
          await call(module, 'post', 'services/quotes', {
            operationKey: randomUUID(),
            partnerId: parent.id,
            title: 'Devis carnet',
            currency: 'CAD',
            lines: [{ catalogItemId: item.id, quantity: 2, unitPrice: 75 }],
          }).expect(201)
        ).body;
        path = `services/quotes/${doc.id}`;
      } else {
        // Fixture only: no transportation entitlement is needed to maintain this invoice.
        doc = await db.customerInvoice.create({
          data: {
            tenantId: tenants[module].id,
            customerId: parent.id,
            invoiceNumber: `CO-${randomUUID()}`,
            currency: 'CAD',
            totalAmount: 150,
          },
        });
        path = `billing/customer-invoices/${doc.id}`;
      }
      const view = (await call(module, 'get', `${path}/coordinates`).expect(200)).body;
      expect(view.captured).toBeNull();
      const body = {
        expectedUpdatedAt: view.updatedAt,
        selections: {
          billingAddress: null,
          deliveryAddress: null,
          contact: { id: entry.id, version: entry.version },
        },
        reason: 'Coordonnées de cet accord',
      };
      await call(module, 'patch', `${path}/coordinates`, body, true).expect(403);
      await call(module, 'patch', `${path}/coordinates`, {
        ...body,
        owner: { id: parent.id },
      }).expect(400);
      await call(module, 'patch', `${path}/coordinates`, {
        ...body,
        selections: {
          ...body.selections,
          contact: { ...body.selections.contact, data: entryBody },
        },
      }).expect(400);
      await call(module, 'patch', `${path}/coordinates`, { ...body, selections: {} }).expect(400);
      await call(module, 'patch', `${path}/coordinates`, {
        ...body,
        selections: {
          billingAddress: body.selections.contact,
          deliveryAddress: null,
          contact: null,
        },
      }).expect(409);
      const other = (
        await call(
          module,
          'post',
          `${module}/data/customers`,
          payload(module === 'services' ? 'client' : 'customer'),
        ).expect(201)
      ).body;
      const foreign = (
        await call(module, 'post', `${module}/data/customers/${other.id}/directory`, {
          operationKey: randomUUID(),
          reason: 'Autre client',
          entry: entryBody,
        }).expect(201)
      ).body;
      await call(module, 'patch', `${path}/coordinates`, {
        ...body,
        selections: { ...body.selections, contact: { id: foreign.id, version: 1 } },
      }).expect(404);
      let selected = (await call(module, 'patch', `${path}/coordinates`, body).expect(200)).body;
      expect(selected.captured.entries.contact.data).toEqual(entryBody);
      expect(selected.captured.frozenAt).toBeNull();
      await call(module, 'patch', `${path}/coordinates`, body).expect(409); // no blind replay of stale edits
      const concurrent = await Promise.all([
        call(module, 'patch', `${path}/coordinates`, {
          ...body,
          expectedUpdatedAt: selected.updatedAt,
          reason: 'Choix opérateur un',
        }),
        call(module, 'patch', `${path}/coordinates`, {
          ...body,
          expectedUpdatedAt: selected.updatedAt,
          reason: 'Choix opérateur deux',
        }),
      ]);
      expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
      selected = concurrent.find((r) => r.status === 200)!.body;
      await call(module, 'get', `${path}/coordinates`, undefined, true).expect(200);
      const newer = (
        await call(module, 'patch', `${directoryPath}/${entry.id}`, {
          operationKey: randomUUID(),
          expectedVersion: 1,
          reason: 'Coordonnée corrigée',
          entry: { ...entryBody, email: 'nouveau@example.test' },
        }).expect(200)
      ).body;
      const changed = (await call(module, 'get', `${path}/coordinates`).expect(200)).body;
      expect(changed.issues).toHaveLength(1);
      expect(changed.captured.entries.contact.data.email).toBe(entryBody.email);
      const commit = (version: string) =>
        module === 'services'
          ? call(module, 'post', `${path}/transition`, {
              status: 'ACCEPTED',
              expectedUpdatedAt: version,
            })
          : call(module, 'post', `${path}/approve`, { expectedUpdatedAt: version });
      await commit(changed.updatedAt).expect(409);
      const revised = (
        await call(module, 'patch', `${path}/coordinates`, {
          ...body,
          expectedUpdatedAt: changed.updatedAt,
          selections: { ...body.selections, contact: { id: entry.id, version: newer.version } },
        }).expect(200)
      ).body;
      await commit(changed.updatedAt).expect(409);
      if (module === 'billing') await call(module, 'post', `${path}/approve`).expect(409);
      await commit(revised.updatedAt).expect(201);
      const frozen = (await call(module, 'get', `${path}/coordinates`).expect(200)).body;
      expect(frozen.captured.frozenAt).toBeTruthy();
      expect(frozen.captured.entries.contact.data.email).toBe('nouveau@example.test');
      await call(module, 'patch', `${directoryPath}/${entry.id}`, {
        operationKey: randomUUID(),
        expectedVersion: 2,
        reason: 'Désactivation après accord',
        entry: { ...entryBody, active: false },
      }).expect(200);
      const historical = (await call(module, 'get', `${path}/coordinates`).expect(200)).body;
      expect(historical.captured).toEqual(frozen.captured);
      expect(historical.issues).toEqual([]);
      await call(module, 'patch', `${path}/coordinates`, {
        ...body,
        expectedUpdatedAt: frozen.updatedAt,
      }).expect(409);
      const alien = module === 'services' ? 'clients' : 'customer-portal';
      await call(alien, 'get', `${path}/coordinates`).expect(403);
      expect(await db.portalUser.count({ where: { tenantId: tenants[module].id } })).toBe(0);
      if (module === 'billing') {
        // Browser fixture: left intentionally in DRAFT for a real UI approval flow.
        await db.customerInvoice.create({
          data: {
            tenantId: tenants[module].id,
            customerId: parent.id,
            invoiceNumber: `CO-UI-${randomUUID()}`,
            totalAmount: 150,
            currency: 'CAD',
          },
        });
        for (const prefix of ['PDF-UI', 'INV-UI'])
          await db.customerInvoice.create({
            data: {
              tenantId: tenants[module].id,
              customerId: parent.id,
              invoiceNumber: `${prefix}-${randomUUID()}`,
              totalAmount: 100,
              currency: 'CAD',
              lines: {
                create: {
                  description: 'Inspection atelier de recette',
                  quantity: 2,
                  unitPrice: 50,
                  amount: 100,
                },
              },
            },
          });
      }
    },
  );

  const directoryData = (label = 'Camille Réception') => ({
    kind: 'CONTACT',
    label,
    role: 'Réception',
    active: true,
    email: 'camille@example.test',
    phone: '+1 514 555 0142',
    address: null,
    validFrom: '2026-09-24',
    validUntil: '2026-10-01',
    notes: 'Appeler avant arrivée',
  });

  it('Transport alone: versioned commercial coordinates never replace operational locations', async () => {
    const module = 'transportation',
      tenantId = tenants[module].id;
    const customer = (
      await call(module, 'post', 'transportation/customers', payload('customer')).expect(201)
    ).body;
    const other = (
      await call(module, 'post', 'transportation/customers', payload('customer')).expect(201)
    ).body;
    const site = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Quai réel',
        addressLine1: '1 rue du Quai',
        city: 'Montréal',
      },
    });
    const orderBody = {
      customerId: customer.id,
      originLocationId: site.id,
      destinationLocationId: site.id,
      totalWeightKg: 250,
    };
    const doc = (
      await call(module, 'post', 'transportation/transport-orders', orderBody).expect(201)
    ).body;
    const path = `transportation/transport-orders/${doc.id}`;
    const directoryPath = `transportation/customers/${customer.id}/directory`;
    const entryBody = {
      ...directoryData('Bureau commercial'),
      kind: 'ADDRESS',
      email: '',
      phone: '',
      validFrom: null,
      validUntil: null,
      address: {
        line1: '42 rue des Bureaux',
        line2: '',
        city: 'Québec',
        region: 'QC',
        countryCode: 'CA',
        postalCode: 'G1K 3X2',
      },
    };
    const entry = (
      await call(module, 'post', directoryPath, {
        operationKey: randomUUID(),
        reason: 'Adresse contractuelle',
        entry: entryBody,
      }).expect(201)
    ).body;
    const selection = {
      expectedUpdatedAt: doc.updatedAt,
      selections: {
        billingAddress: { id: entry.id, version: 1 },
        deliveryAddress: { id: entry.id, version: 1 },
        contact: null,
      },
      reason: 'Adresse confirmée',
    };
    await call(module, 'patch', `${path}/coordinates`, selection, true).expect(403);
    await call(module, 'patch', `${path}/coordinates`, { ...selection, tenantId }).expect(400);
    await call(module, 'patch', `${path}/coordinates`, {
      ...selection,
      selections: { ...selection.selections, contact: { id: entry.id, version: 1 } },
    }).expect(409);
    // Same-module cross-tenant calls cannot use the new reader or writer.
    const foreignTenant = await db.tenant.create({
      data: { slug: `${slug}-foreign-tms`, name: 'Autre entreprise' },
    });
    const definition = await db.moduleDefinition.findUniqueOrThrow({ where: { key: module } });
    await db.tenantModule.create({
      data: { tenantId: foreignTenant.id, moduleId: definition.id, enabled: true },
    });
    const foreign = await actor(foreignTenant.id, `${slug}-foreign-tms`, 'manager', [
      'transportation.orders.read',
      'transportation.orders.manage',
      'transportation.master-data.read',
    ]);
    await request(http)
      .get(`/api/v1/${path}/coordinates`)
      .set('Authorization', `Bearer ${foreign.token}`)
      .expect(404);
    await request(http)
      .patch(`/api/v1/${path}/coordinates`)
      .set('Authorization', `Bearer ${foreign.token}`)
      .send(selection)
      .expect(404);
    const selected = (await call(module, 'patch', `${path}/coordinates`, selection).expect(200))
      .body;
    await call(module, 'get', `${path}/coordinates`, undefined, true).expect(200);
    await call(module, 'post', `${path}/confirm`).expect(409);
    await call(module, 'patch', path, { notes: 'Sans version' }).expect(409);
    await call(module, 'patch', path, {
      customerId: other.id,
      expectedUpdatedAt: selected.updatedAt,
    }).expect(409);
    // Editing the order invalidates the version reviewed for confirmation.
    const edited = (
      await call(module, 'patch', path, {
        notes: 'Instruction revue',
        expectedUpdatedAt: selected.updatedAt,
      }).expect(200)
    ).body;
    await call(module, 'post', `${path}/confirm`, { expectedUpdatedAt: selected.updatedAt }).expect(
      409,
    );
    await call(module, 'patch', `${directoryPath}/${entry.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Rue corrigée',
      entry: { ...entryBody, address: { ...entryBody.address, line1: '44 rue des Bureaux' } },
    }).expect(200);
    await call(module, 'post', `${path}/confirm`, { expectedUpdatedAt: edited.updatedAt }).expect(
      409,
    );
    const reviewed = (
      await call(module, 'patch', `${path}/coordinates`, {
        ...selection,
        expectedUpdatedAt: edited.updatedAt,
        selections: {
          ...selection.selections,
          billingAddress: { id: entry.id, version: 2 },
          deliveryAddress: { id: entry.id, version: 2 },
        },
      }).expect(200)
    ).body;
    const confirmed = (
      await call(module, 'post', `${path}/confirm`, {
        expectedUpdatedAt: reviewed.updatedAt,
      }).expect(201)
    ).body;
    expect(confirmed.documentCoordinates.frozenAt).toBeTruthy();
    expect(confirmed.originLocationId).toBe(site.id);
    expect(confirmed.destinationLocationId).toBe(site.id);
    expect(confirmed.shipments).toHaveLength(0);
    await call(module, 'patch', `${directoryPath}/${entry.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 2,
      reason: 'Bureau fermé',
      entry: { ...entryBody, active: false },
    }).expect(200);
    const historical = (await call(module, 'get', `${path}/coordinates`).expect(200)).body;
    expect(historical.captured).toEqual(confirmed.documentCoordinates);
    expect(historical.issues).toEqual([]);
    await call(module, 'patch', `${path}/coordinates`, {
      ...selection,
      expectedUpdatedAt: historical.updatedAt,
    }).expect(409);
    await call(module, 'post', `${path}/plan`).expect(201);
    const shipments = await db.shipment.findMany({ where: { tenantId, transportOrderId: doc.id } });
    expect(shipments).toHaveLength(1);
    expect(shipments[0].originLocationId).toBe(site.id);
    expect(shipments[0].destinationLocationId).toBe(site.id);
    expect(await db.emailMessage.count({ where: { tenantId } })).toBe(0);
    expect(await db.portalUser.count({ where: { tenantId } })).toBe(0);
    // Explicit clearing permits changing the customer, without assigning another owner's copy.
    const clearDoc = (
      await call(module, 'post', 'transportation/transport-orders', orderBody).expect(201)
    ).body;
    const clearPath = `transportation/transport-orders/${clearDoc.id}`;
    const freshEntry = (
      await call(module, 'post', directoryPath, {
        operationKey: randomUUID(),
        reason: 'Nouvel accord',
        entry: entryBody,
      }).expect(201)
    ).body;
    const clearedSelection = {
      ...selection,
      expectedUpdatedAt: clearDoc.updatedAt,
      selections: {
        billingAddress: { id: freshEntry.id, version: 1 },
        deliveryAddress: null,
        contact: null,
      },
    };
    const withoutDirectoryRight = await actor(tenantId, `${slug}-transportation`, 'order-only', [
      'transportation.orders.read',
      'transportation.orders.manage',
    ]);
    await request(http)
      .patch(`/api/v1/${clearPath}/coordinates`)
      .set('Authorization', `Bearer ${withoutDirectoryRight.token}`)
      .send(clearedSelection)
      .expect(403);
    const chosen = (
      await call(module, 'patch', `${clearPath}/coordinates`, clearedSelection).expect(200)
    ).body;
    const cleared = (
      await call(module, 'patch', `${clearPath}/coordinates`, {
        expectedUpdatedAt: chosen.updatedAt,
        selections: { billingAddress: null, deliveryAddress: null, contact: null },
        reason: 'Changer le client explicitement',
      }).expect(200)
    ).body;
    expect(cleared.captured).toBeNull();
    await call(module, 'patch', clearPath, {
      customerId: other.id,
      expectedUpdatedAt: cleared.updatedAt,
    }).expect(200);
    const legacy = (await call(module, 'post', `${clearPath}/confirm`).expect(201)).body;
    expect(legacy.documentCoordinates).toBeNull();
    expect(legacy.customerId).toBe(other.id);
    records.tmsOrderBody = orderBody;
    records.tmsCustomer = customer;
    records.tmsSite = site;
  });

  it('Transport order writers: concurrent confirmation/edit and atomic planning', async () => {
    const module = 'transportation',
      tenantId = tenants[module].id;
    const create = async () =>
      (
        await call(module, 'post', 'transportation/transport-orders', records.tmsOrderBody).expect(
          201,
        )
      ).body;
    const raced = await create(),
      path = `transportation/transport-orders/${raced.id}`;
    const outcomes = await Promise.all([
      call(module, 'patch', path, { notes: 'Concurrent', expectedUpdatedAt: raced.updatedAt }),
      call(module, 'post', `${path}/confirm`, { expectedUpdatedAt: raced.updatedAt }),
    ]);
    expect(outcomes.filter((r) => r.status < 300)).toHaveLength(1);
    expect(outcomes.every((r) => [200, 201, 400, 409].includes(r.status))).toBe(true);
    const plannedDoc = await create(),
      planPath = `transportation/transport-orders/${plannedDoc.id}`;
    await call(module, 'post', `${planPath}/confirm`).expect(201);
    // Second split passes DTO shape but fails business window coherence. First must roll back.
    await call(module, 'post', `${planPath}/plan`, {
      shipments: [
        { weightKg: 100 },
        {
          weightKg: 50,
          plannedPickupEarly: '2026-10-02T12:00:00Z',
          plannedPickupLate: '2026-10-01T12:00:00Z',
        },
      ],
    }).expect(400);
    expect(await db.shipment.count({ where: { tenantId, transportOrderId: plannedDoc.id } })).toBe(
      0,
    );
    expect((await call(module, 'get', planPath).expect(200)).body.status).toBe('CONFIRMED');
    const plans = await Promise.all([
      call(module, 'post', `${planPath}/plan`),
      call(module, 'post', `${planPath}/plan`),
    ]);
    expect(plans.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await db.shipment.count({ where: { tenantId, transportOrderId: plannedDoc.id } })).toBe(
      1,
    );
    const frozen = (await call(module, 'get', planPath).expect(200)).body;
    await call(module, 'post', `${planPath}/shipments`, { weightKg: 25 }).expect(201);
    const appended = (await call(module, 'get', planPath).expect(200)).body;
    expect(appended.updatedAt).not.toBe(frozen.updatedAt);
    expect(appended.shipments).toHaveLength(2);
    expect(
      await db.auditLog.count({
        where: { tenantId, entityType: 'transport-order', entityId: plannedDoc.id },
      }),
    ).toBeGreaterThanOrEqual(3);
    // No module activation leakage from the shared coordinates controller.
    await call('billing', 'get', `${planPath}/coordinates`).expect(403);
    await call(module, 'get', 'clients/data/customers').expect(403);
  });
  it.each(REFERENCE_ACCESS.filter((a) => ['customer', 'client', 'supplier'].includes(a.kind)))(
    '$path: own directory, history and read-only rights without another module',
    async (access) => {
      const parent = records[access.path],
        path = `${access.path}/${parent.id}/directory`;
      const body = {
        operationKey: randomUUID(),
        reason: 'Ajout au carnet partagé',
        entry: directoryData(),
      };
      const created = (await call(access.module, 'post', path, body).expect(201)).body;
      expect(created.version).toBe(1);
      expect(created).not.toHaveProperty('tenantId');
      expect(created).not.toHaveProperty('actorId');
      expect((await call(access.module, 'get', path, undefined, true).expect(200)).body.total).toBe(
        1,
      );
      expect(
        (
          await call(access.module, 'get', `${path}/${created.id}/history`, undefined, true).expect(
            200,
          )
        ).body.items[0].snapshot.data,
      ).toEqual(body.entry);
      await call(access.module, 'post', path, { ...body, operationKey: randomUUID() }, true).expect(
        403,
      );
      await call(
        access.module,
        'patch',
        `${path}/${created.id}`,
        { ...body, expectedVersion: 1 },
        true,
      ).expect(403);
      await call(access.module, 'post', path, { ...body, tenantId: tenants.billing.id }).expect(
        400,
      );
      await call(access.module, 'post', path, {
        ...body,
        entry: { ...body.entry, permissions: ['admin'] },
      }).expect(400);
      await call(access.module, 'patch', `${path}/${created.id}`, body).expect(400);
      expect(
        (await call(access.module, 'get', `${access.path}/${parent.id}`).expect(200)).body
          .updatedAt,
      ).toBe(parent.updatedAt);
      expect(
        await db.partyDirectoryRevision.count({
          where: { tenantId: tenants[access.module].id, entryId: created.id },
        }),
      ).toBe(1);
    },
  );
  it('directory retries are idempotent and versioned concurrency never rewrites history', async () => {
    const parent = records['clients/data/customers'],
      path = `clients/data/customers/${parent.id}/directory`;
    const body = {
      operationKey: randomUUID(),
      reason: 'Création avec réponse perdue',
      entry: directoryData('Reprise concurrente'),
    };
    const creates = await Promise.all([
      call('clients', 'post', path, body),
      call('clients', 'post', path, body),
    ]);
    expect(creates.map((r) => r.status)).toEqual([201, 201]);
    expect(creates[0].body).toEqual(creates[1].body);
    const id = creates[0].body.id;
    const edits = await Promise.all(
      ['A', 'B'].map((suffix) =>
        call('clients', 'patch', `${path}/${id}`, {
          operationKey: randomUUID(),
          reason: 'Changement ' + suffix,
          expectedVersion: 1,
          entry: { ...body.entry, label: 'Version ' + suffix, active: false },
        }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const replay = (await call('clients', 'post', path, body).expect(201)).body;
    expect(replay.version).toBe(1);
    const history = (await call('clients', 'get', `${path}/${id}/history`).expect(200)).body;
    expect(history.total).toBe(2);
    expect(history.items.map((r: any) => r.version)).toEqual([2, 1]);
    expect(history.items[1].snapshot.data).toEqual(body.entry);
    expect(
      (
        await db.partyDirectoryEntry.findFirstOrThrow({
          where: { id, tenantId: tenants.clients.id },
        })
      ).version,
    ).toBe(2);
    await call('clients', 'post', path, { ...body, entry: directoryData('Autre contenu') }).expect(
      409,
    );
  });
  it('directory isolation includes parent, entry, history and pagination', async () => {
    const parent = records['clients/data/customers'],
      path = `clients/data/customers/${parent.id}/directory`;
    const foreign = records['billing/data/customers'];
    await call('clients', 'get', `clients/data/customers/${foreign.id}/directory`).expect(404);
    await call('clients', 'post', `clients/data/customers/${foreign.id}/directory`, {
      operationKey: randomUUID(),
      reason: 'Interdit',
      entry: directoryData(),
    }).expect(404);
    const other = (
      await call('clients', 'post', 'clients/data/customers', payload('customer')).expect(201)
    ).body;
    const first = (await call('clients', 'get', path + '?pageSize=1').expect(200)).body;
    expect(first.total).toBeGreaterThan(1);
    expect(first.items).toHaveLength(1);
    await call(
      'clients',
      'get',
      `clients/data/customers/${other.id}/directory/${first.items[0].id}/history`,
    ).expect(404);
    await call(
      'clients',
      'patch',
      `clients/data/customers/${other.id}/directory/${first.items[0].id}`,
      {
        operationKey: randomUUID(),
        expectedVersion: 1,
        reason: 'Interdit',
        entry: directoryData(),
      },
    ).expect(404);
    await call('clients', 'get', path + '?pageSize=101').expect(400);
    await call('services', 'get', path).expect(403);
  });
  it('directory accepts multiple separate sites without replacing legacy defaults or granting portal access', async () => {
    const parent = records['clients/data/customers'],
      path = `clients/data/customers/${parent.id}/directory`;
    const before = (await call('clients', 'get', `clients/data/customers/${parent.id}`).expect(200))
      .body;
    for (const city of ['Montréal', 'Québec'])
      await call('clients', 'post', path, {
        operationKey: randomUUID(),
        reason: 'Nouveau site de livraison',
        entry: {
          ...directoryData(city),
          kind: 'ADDRESS',
          role: 'Livraison',
          address: {
            line1: '12 Rue du Port',
            line2: '',
            city,
            region: 'QC',
            countryCode: 'CA',
            postalCode: 'H2Y 1C6',
          },
        },
      }).expect(201);
    expect((await call('clients', 'get', path + '?kind=ADDRESS').expect(200)).body.total).toBe(2);
    const after = (await call('clients', 'get', `clients/data/customers/${parent.id}`).expect(200))
      .body;
    expect(after).toEqual(before);
    expect(
      await db.portalUser.count({ where: { tenantId: tenants.clients.id, customerId: parent.id } }),
    ).toBe(0);
  });

  it('saves each user time zone independently and preserves other preferences', async () => {
    await call('clients', 'put', 'me/preferences', {
      timeZone: 'America/Vancouver',
      moduleTour: { moduleKey: 'clients', version: 1, step: 1, status: 'IN_PROGRESS' },
    }).expect(200);
    const saved = (await call('clients', 'get', 'me/preferences').expect(200)).body;
    expect(saved.timeZone).toBe('America/Vancouver');
    expect(saved.moduleTours.clients.step).toBe(1);
    expect(
      (await call('clients', 'get', 'me/preferences', undefined, true).expect(200)).body.timeZone,
    ).toBeNull();
    await call('clients', 'put', 'me/preferences', { timeZone: 'Invented/Invalid' }).expect(400);
    await call('clients', 'put', 'me/preferences', { timeZone: null }).expect(200);
    const reset = (await call('clients', 'get', 'me/preferences').expect(200)).body;
    expect(reset.timeZone).toBeNull();
    expect(reset.moduleTours.clients.step).toBe(1);
  });
  it.each(['customers', 'partners'])(
    'Clients alone maintains independent addresses for %s with guarded versions',
    async (resource) => {
      const address = {
        line1: '12 Rue du Port',
        city: 'Montréal',
        countryCode: 'CA',
        postalCode: 'H2Y 1C6',
      };
      const path = `clients/data/${resource}`;
      const created = (
        await call('clients', 'post', path, {
          code: randomUUID(),
          name: 'Adresses indépendantes',
          billingAddress: address,
          shippingAddress: { ...address, city: 'Boston', countryCode: 'US', postalCode: '02108' },
        }).expect(201)
      ).body;
      const updated = (
        await call('clients', 'patch', `${path}/${created.id}`, {
          expectedUpdatedAt: created.updatedAt,
          billingAddress: null,
        }).expect(200)
      ).body;
      expect(updated.billingAddress).toBeNull();
      expect(updated.shippingAddress.city).toBe('Boston');
      await call('clients', 'patch', `${path}/${created.id}`, {
        expectedUpdatedAt: created.updatedAt,
        name: 'Stale',
      }).expect(409);
      await call('clients', 'patch', `${path}/${created.id}`, {
        expectedUpdatedAt: updated.updatedAt,
        shippingAddress: { ...address, tenantId: tenants.fleet.id },
      }).expect(400);
      await call(
        'clients',
        'get',
        resource === 'customers'
          ? `clients/data/customers/${records['billing/data/customers'].id}`
          : `clients/data/partners/${records['services/data/customers'].id}`,
      ).expect(404);
    },
  );
  it('isolates tenants, partner roles, versions and operational asset status', async () => {
    await call('yard', 'get', `yard/data/trailers/${records['fleet/data/trailers'].id}`).expect(
      404,
    );
    await call('yard', 'patch', `yard/data/trailers/${records['fleet/data/trailers'].id}`, {
      plate: 'NO',
    }).expect(404);
    await call('fleet', 'post', 'fleet/data/vehicles', {
      ...payload('vehicle'),
      carrierId: records['yard/data/carriers'].id,
    }).expect(400);
    await call('fleet', 'patch', `fleet/data/vehicles/${records['fleet/data/vehicles'].id}`, {
      status: 'AVAILABLE',
    }).expect(400);
    await call('yard', 'patch', `yard/data/trailers/${records['yard/data/trailers'].id}`, {
      status: 'RETIRED',
    }).expect(400);
    const client = records['services/data/customers'];
    await call('services', 'patch', `services/data/customers/${client.id}`, {
      expectedUpdatedAt: client.updatedAt,
      isSupplier: true,
    }).expect(400);
    await call('services', 'patch', `services/data/customers/${client.id}`, {
      expectedUpdatedAt: '2000-01-01T00:00:00Z',
      name: 'Stale',
    }).expect(409);
    const supplier = await db.businessPartner.create({
      data: {
        tenantId: tenants.services.id,
        code: 'ONLY-SUPPLIER',
        name: 'Supplier',
        isCustomer: false,
        isSupplier: true,
      },
    });
    await call('services', 'get', `services/data/customers/${supplier.id}`).expect(404);
    await call('services', 'patch', `services/data/customers/${supplier.id}`, {
      expectedUpdatedAt: supplier.updatedAt.toISOString(),
      name: 'No',
    }).expect(404);
  });
  it('actually starts a project, purchase and support case without Catalogue', async () => {
    await call('services', 'post', 'services/projects', {
      title: 'Projet autonome',
      partnerId: records['services/data/customers'].id,
    }).expect(201);
    await call('purchasing', 'post', 'purchasing/orders', {
      supplierId: records['purchasing/data/suppliers'].id,
      currency: 'CAD',
      lines: [{ catalogItemId: records['purchasing/data/items'].id, quantity: 2, unitPrice: 10 }],
    }).expect(201);
    await call('support', 'post', 'support/cases', {
      partnerId: records['support/data/customers'].id,
      title: 'Assistance autonome',
      description: 'Vérifier le dossier',
      priority: 'NORMAL',
      operationKey: randomUUID(),
    }).expect(201);
  });
  it('does not turn shared data access into access to another business module', async () => {
    for (const module of Object.keys(tenants)) {
      if (module !== 'transportation')
        await call(module, 'get', 'transportation/loads').expect(403);
      if (module !== 'services') await call(module, 'get', 'services/data/customers').expect(403);
    }
    const billing = tenants.billing;
    const paymentOnly = await actor(billing.id, `${slug}-billing`, 'payments-only', [
      'billing.payments.read',
      'billing.payments.manage',
    ]);
    await request(http)
      .get('/api/v1/billing/payments/data/customers')
      .set('Authorization', `Bearer ${paymentOnly.token}`)
      .expect(200);
    await request(http)
      .get('/api/v1/billing/data/customers')
      .set('Authorization', `Bearer ${paymentOnly.token}`)
      .expect(403);
  });
  it('revokes data access when the consumer module is disabled, even with valid permissions', async () => {
    await db.tenantModule.updateMany({
      where: { tenantId: tenants.yard.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenants.yard.id);
    await call('yard', 'get', 'yard/data/carriers').expect(403);
    await call('yard', 'post', 'yard/data/carriers', payload('carrier')).expect(403);
  });
  it('connects Services/Purchasing to Billing and WMS without enabling Catalogue or Transport', async () => {
    const slugConnected = `${slug}-connected`;
    const tenant = await db.tenant.create({
      data: { slug: slugConnected, name: 'Connected without Catalogue' },
    });
    for (const key of ['services', 'purchasing', 'billing', 'wms']) {
      const entry = MODULE_CATALOG.find((m) => m.key === key)!;
      const definition = await db.moduleDefinition.upsert({
        where: { key },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({
        data: { tenantId: tenant.id, moduleId: definition.id, enabled: true },
      });
    }
    const user = await actor(tenant.id, slugConnected, 'connected', [
      'services.read',
      'services.manage',
      'purchasing.read',
      'purchasing.manage',
      'billing.customer-invoices.read',
      'billing.customer-invoices.manage',
      'wms.read',
    ]);
    const run = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
      request(http)
        [method]('/api/v1/' + path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body);
    const partner = (await run('post', 'services/data/customers', payload('client')).expect(201))
      .body;
    const link = (
      await run('post', `services/partners/${partner.id}/billing-customer`, {
        expectedUpdatedAt: partner.updatedAt,
      }).expect(201)
    ).body;
    expect(
      (
        await run('post', `services/partners/${partner.id}/billing-customer`, {
          expectedUpdatedAt: partner.updatedAt,
        }).expect(201)
      ).body.customerId,
    ).toBe(link.customerId);
    expect(
      (await run('get', `services/partners/${partner.id}/links`).expect(200)).body
        .billingCustomerId,
    ).toBe(link.customerId);
    expect(
      (await run('get', 'services/references/billing-customers').expect(200)).body.items,
    ).toHaveLength(1);
    const product = (
      await run('post', 'purchasing/data/items', {
        code: 'BOLT',
        name: 'Boulon',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    const wms = await db.wmsItem.create({
      data: { tenantId: tenant.id, sku: 'BOLT-WMS', name: 'Boulon', unit: 'EA' },
    });
    await run('patch', `purchasing/items/${product.id}/stock-link`, {
      expectedUpdatedAt: product.updatedAt,
      wmsItemId: wms.id,
    }).expect(200);
    expect(
      (await run('get', `services/items/${product.id}/stock-link`).expect(200)).body.stockLink
        .wmsItem.id,
    ).toBe(wms.id);
    await run('get', 'catalog/items').expect(403);
    await run('get', 'transportation/customers').expect(403);
    const reader = await actor(tenant.id, slugConnected, 'no-wms', [
      'services.read',
      'services.manage',
    ]);
    await request(http)
      .get(`/api/v1/services/items/${product.id}/stock-link`)
      .set('Authorization', `Bearer ${reader.token}`)
      .expect(403);
    await db.tenantModule.updateMany({
      where: { tenantId: tenant.id, module: { key: 'wms' } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenant.id);
    await run('get', `services/items/${product.id}/stock-link`).expect(403);
  });
});
