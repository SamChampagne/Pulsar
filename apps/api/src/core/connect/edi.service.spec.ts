/**
 * Unit spec of the EDI plane (task C4). Everything is mocked: the point is the
 * governance around the pure `@pulsar/shared/edi` layer — module gating,
 * configured foreign keys, the 990 we answer with, idempotency, and the AT7
 * ordering of an outbound 214.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShipmentStatus, TrackingEventType, parseX12, read214, read990 } from '@pulsar/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CryptoService } from '../crypto/crypto.service';
import type { LocationsService } from '../locations/locations.service';
import type { WebhooksService } from '../integrations/webhooks.service';
import type { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import type { FreightAuditService } from '../../modules/billing/freight-audit/freight-audit.service';
import { EdiService, ediDedupKey, ediLocationCode, ediWeightToKg } from './edi.service';

const FIXTURES = join(__dirname, '../../../../../packages/shared/src/edi/__fixtures__');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

const TENANT = 'tenant_1';

interface HarnessOptions {
  config?: Record<string, unknown>;
  modules?: string[];
  customerExists?: boolean;
  carrierExists?: boolean;
  locationExists?: boolean;
  duplicateInvoice?: boolean;
  status?: 'ENABLED' | 'DISABLED';
  /** Makes a business service blow up with a NON-decline error (internals). */
  explodeWith?: string;
}

function harness(options: HarnessOptions = {}) {
  const inbox: any[] = [];
  const updates: any[] = [];
  const audits: any[] = [];
  const orders: any[] = [];
  const invoices: any[] = [];
  const createdLocations: any[] = [];
  const deliveries: any[] = [];
  let shipmentCall = 0;

  const config = {
    isaSenderId: 'PULSARTMS',
    isaReceiverId: 'ACMESHIPPER',
    customerId: 'cust_1',
    carrierId: 'carr_1',
    ...options.config,
  };

  const prisma = {
    integration: {
      findUnique: async ({ where }: any) => ({
        id: 'int_1',
        tenantId: TENANT,
        name: 'Acme EDI',
        key: where.tenantId_key.key,
        status: options.status ?? 'ENABLED',
        config,
      }),
    },
    inboundMessage: {
      findFirst: async ({ where }: any) =>
        where.dedupKey
          ? inbox.find((row) => row.dedupKey === where.dedupKey)
          : inbox.find((row) => row.id === where.id),
      create: async ({ data }: any) => {
        if (inbox.some((row) => row.dedupKey === data.dedupKey)) {
          const err: any = new Error('unique');
          err.code = 'P2002';
          err.constructor = { name: 'PrismaClientKnownRequestError' };
          throw err;
        }
        const row = { id: `inbox_${inbox.length + 1}`, ...data };
        inbox.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        updates.push({ id: where.id, tenantId: where.tenantId, ...data });
        const row = inbox.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    incomingCarrierInvoice: {
      findFirst: async () => (options.duplicateInvoice ? { id: 'dup_1' } : null),
    },
    customer: {
      findFirst: async () => (options.customerExists === false ? null : { id: 'cust_1' }),
    },
    carrier: {
      findFirst: async () => (options.carrierExists === false ? null : { id: 'carr_1' }),
    },
    location: {
      findUnique: async ({ where }: any) =>
        options.locationExists ? { id: `loc_${where.tenantId_code.code}` } : null,
    },
    shipment: {
      findFirst: async () => {
        shipmentCall += 1;
        // 1st call: the shared tracking projection. 2nd: the EDI-only details.
        if (shipmentCall === 1) {
          return {
            tenantId: TENANT,
            shipmentNumber: 'SH-000042',
            status: ShipmentStatus.DELIVERED,
            loadId: null,
            tenant: { name: 'Acme' },
            originLocation: { city: 'Montreal', state: 'QC', latitude: null, longitude: null },
            destinationLocation: { city: 'Toronto', state: 'ON', latitude: null, longitude: null },
            proofOfDelivery: null,
            plannedPickupEarly: null,
            plannedPickupLate: null,
            plannedDeliveryEarly: null,
            plannedDeliveryLate: null,
            actualPickupAt: new Date('2026-09-21T13:00:00Z'),
            actualDeliveryAt: new Date('2026-09-22T15:00:00Z'),
            trackingEvents: [
              // Newest first, exactly like the projection.
              {
                id: 'ev3',
                type: TrackingEventType.DELIVERED,
                message: null,
                occurredAt: new Date('2026-09-22T15:00:00Z'),
              },
              {
                id: 'ev2',
                type: TrackingEventType.DEPARTED_STOP,
                message: null,
                occurredAt: new Date('2026-09-21T14:00:00Z'),
              },
              {
                id: 'ev1',
                type: TrackingEventType.DISPATCHED,
                message: null,
                occurredAt: new Date('2026-09-21T08:00:00Z'),
              },
            ],
          };
        }
        return {
          transportOrder: { orderNumber: 'TO-000007', customerReference: 'PO-88231' },
          load: {
            loadNumber: 'LD-000003',
            carrier: { scacCode: 'CRXY' },
            trailer: { unitNumber: '53101' },
          },
        };
      },
    },
    trackingEvent: {
      findMany: async () => [{ id: 'ev2', stop: { type: 'PICKUP' } }],
      groupBy: async () => [],
    },
  } as unknown as PrismaService;

  const crypto = {
    decryptJson: (value: unknown) => value as Record<string, unknown>,
  } as unknown as CryptoService;

  const modulesCache = {
    getEnabledKeys: async () => new Set(options.modules ?? ['transportation', 'billing']),
  } as unknown as TenantModulesCacheService;

  const apiKeys = { ensureServiceUser: async () => 'svc_1' } as unknown as ApiKeysService;
  const audit = {
    log: async (entry: any) => {
      audits.push(entry);
    },
  } as unknown as AuditLogsService;

  const locations = {
    create: async (_tenantId: string, dto: any) => {
      createdLocations.push(dto);
      return { id: `loc_${createdLocations.length}` };
    },
  } as unknown as LocationsService;

  const transportOrders = {
    create: async (_tenantId: string, userId: string, dto: any) => {
      if (options.explodeWith) throw new Error(options.explodeWith);
      orders.push({ userId, ...dto });
      return { id: `to_${orders.length}`, orderNumber: `TO-00000${orders.length}` };
    },
  } as unknown as TransportOrdersService;

  const freightAudit = {
    create: async (_tenantId: string, userId: string, dto: any, sourceRef: string) => {
      if (options.explodeWith) throw new Error(options.explodeWith);
      invoices.push({ userId, sourceRef, ...dto });
      return { id: `inv_${invoices.length}` };
    },
  } as unknown as FreightAuditService;

  const webhooks = {
    emitToIntegration: async (...args: unknown[]) => {
      deliveries.push(args);
      return { id: `del_${deliveries.length}` };
    },
  } as unknown as WebhooksService;

  return {
    svc: new EdiService(
      prisma,
      crypto,
      modulesCache,
      apiKeys,
      audit,
      locations,
      transportOrders,
      freightAudit,
      webhooks,
    ),
    inbox,
    updates,
    audits,
    orders,
    invoices,
    createdLocations,
    deliveries,
  };
}

/** First (and only) transaction of an interchange the tests just built. */
function firstTransaction(x12: string) {
  const parsed = parseX12(x12);
  expect(parsed.ok).toBe(true);
  return parsed.document!.transactions[0];
}

describe('EdiService — pure helpers', () => {
  it('derives a stable EDI- location code, insensitive to case and spacing', () => {
    const a = ediLocationCode([
      '1200 Rue Notre-Dame Ouest',
      undefined,
      'Montreal',
      'QC',
      'H3C1K3',
      'CA',
    ]);
    const b = ediLocationCode([
      '  1200   RUE NOTRE-DAME OUEST ',
      '',
      'montreal',
      'qc',
      'h3c1k3',
      'ca',
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^EDI-[0-9a-f]{12}$/);
    expect(a).not.toBe(ediLocationCode(['8000 Jetliner Road', 'Mississauga']));
  });

  it('converts an X12 weight to kilograms only when the unit says pounds', () => {
    expect(ediWeightToKg(24000, 'L')).toBe(10886.22);
    expect(ediWeightToKg(24000, 'K')).toBe(24000);
    expect(ediWeightToKg(undefined, 'L')).toBeUndefined();
  });
});

describe('EdiService — 204 load tender', () => {
  it('creates a DRAFT transport order and answers an accepting 990', async () => {
    const h = harness();
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-multistop.edi'),
    });

    expect(result.status).toBe('IMPORTED');
    expect(result.transactionSetId).toBe('204');
    expect(result.entityType).toBe('transport-order');
    expect(h.orders).toHaveLength(1);

    const order = h.orders[0];
    expect(order.userId).toBe('svc_1'); // rule 13 — the tenant service-account
    expect(order.customerId).toBe('cust_1');
    expect(order.customerReference).toBe('SHP-2026-0042');
    expect(order.requestedPickupEarly).toBe('2026-09-21T08:00');
    expect(order.requestedDeliveryLate).toBe('2026-09-22T17:00');
    // 24000 lb of pickups → kg.
    expect(order.totalWeightKg).toBe(10886.22);

    // Origin = first pickup, destination = LAST delivery; both created as CUSTOMER_SITE.
    expect(h.createdLocations.map((l) => l.city)).toEqual(['MONTREAL', 'MISSISSAUGA']);
    expect(h.createdLocations.every((l) => l.type === 'CUSTOMER_SITE')).toBe(true);
    expect(h.createdLocations.every((l) => /^EDI-[0-9a-f]{12}$/.test(l.code))).toBe(true);

    const ack = read990(firstTransaction(result.ack!));
    expect(ack.accepted).toBe(true);
    expect(ack.shipmentId).toBe('SHP-2026-0042');
    expect(ack.scac).toBe('CRXY');
    expect(ack.references.map((r) => r.value)).toContain('TO-000001');

    // The inbox row carries the outcome and the ack we answered, and the update
    // is tenant-scoped (rule 1) while keeping what the claim already wrote.
    const update = h.updates.at(-1);
    expect(update.status).toBe('IMPORTED');
    expect(update.refType).toBe('transport-order');
    expect(update.tenantId).toBe(TENANT);
    expect(update.parsed.bytes).toBeGreaterThan(0);
    expect(update.parsed.ack).toBe(result.ack);
    expect(h.audits.some((a) => a.entityType === 'inbound-message')).toBe(true);
    expect(h.audits.some((a) => a.entityType === 'location')).toBe(true);
  });

  it('reuses an existing EDI- location instead of creating a duplicate', async () => {
    const h = harness({ locationExists: true });
    await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });
    expect(h.createdLocations).toHaveLength(0);
    expect(h.orders).toHaveLength(1);
  });

  it('declines (990 "D") when the integration carries no customerId', async () => {
    const h = harness({ config: { customerId: '' } });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(h.orders).toHaveLength(0);

    const ack = read990(firstTransaction(result.ack!));
    expect(ack.declined).toBe(true);
    expect(ack.action).toBe('D');
    expect(ack.reason).toContain('customerId');
    expect(h.updates.at(-1).status).toBe('FAILED');
  });

  it('declines when the Transportation module is disabled (rule 15)', async () => {
    const h = harness({ modules: ['billing'] });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(read990(firstTransaction(result.ack!)).declined).toBe(true);
    expect(h.orders).toHaveLength(0);
  });

  it('declines when the configured customerId belongs to nobody', async () => {
    const h = harness({ customerExists: false });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(read990(firstTransaction(result.ack!)).reason).toContain('unknown');
  });
});

describe('EdiService — 210 carrier invoice', () => {
  it('creates an incoming carrier invoice with one line per LX loop', async () => {
    const h = harness();
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-carrier',
      content: fixture('210-invoice.edi'),
    });

    expect(result.status).toBe('IMPORTED');
    expect(result.transactionSetId).toBe('210');
    expect(result.entityType).toBe('incoming-carrier-invoice');
    expect(result.ack).toBeUndefined(); // a 210 is not answered with a 990

    const invoice = h.invoices[0];
    expect(invoice.userId).toBe('svc_1');
    expect(invoice.sourceRef).toBe('edi-210');
    expect(invoice.carrierId).toBe('carr_1');
    expect(invoice.carrierInvoiceNumber).toBe('INV-77410');
    expect(invoice.currency).toBe('CAD');
    expect(invoice.lines.map((l: any) => l.chargedAmount)).toEqual([2250, 337.5, 98]);
    expect(invoice.lines.map((l: any) => l.lineRef)).toEqual(['1', '405', '400']);
  });

  it('fails when the Billing module is disabled (rule 15)', async () => {
    const h = harness({ modules: ['transportation'] });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-carrier',
      content: fixture('210-invoice.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('Billing');
    expect(h.invoices).toHaveLength(0);
  });

  it('fails when no carrierId is configured', async () => {
    const h = harness({ config: { carrierId: undefined } });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-carrier',
      content: fixture('210-invoice.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('carrierId');
  });
});

describe('EdiService — intake guards', () => {
  it('refuses an unreadable interchange without pretending to answer', async () => {
    const h = harness();
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: 'not an interchange at all',
    });
    expect(result.status).toBe('FAILED');
    expect(result.ack).toBeUndefined();
    expect(result.error).toContain('illisible');
  });

  it('refuses an unsupported transaction set', async () => {
    const h = harness();
    const content = fixture('204-multistop.edi').replace('ST*204*0001', 'ST*211*0001');
    const result = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('211');
  });

  it('is idempotent on the interchange bytes', async () => {
    const h = harness();
    const content = fixture('204-minimal.edi');
    const first = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });
    const second = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });
    expect(second.replayed).toBe(true);
    expect(second.inboxId).toBe(first.inboxId);
    expect(h.orders).toHaveLength(1);
  });

  it('only resolves integrations of the edi- namespace, and only when enabled', async () => {
    const h = harness();
    await expect(
      h.svc.receive(TENANT, { integrationKey: 'webhook-main', content: 'x' }),
    ).rejects.toThrow(/edi-/);
    await expect(h.svc.receive(TENANT, { content: 'x' })).rejects.toThrow(/integrationKey/);

    const disabled = harness({ status: 'DISABLED' });
    await expect(
      disabled.svc.receive(TENANT, {
        integrationKey: 'edi-acme',
        content: fixture('204-minimal.edi'),
      }),
    ).rejects.toThrow(/not enabled/);
  });
});

describe('EdiService — partner-safe failures', () => {
  it('204: an unexpected error never reaches the partner, only the inbox', async () => {
    const h = harness({ explodeWith: 'connect ECONNREFUSED 10.0.0.7:5432 (transport_orders)' });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Tender could not be processed');
    expect(result.summary).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(result)).not.toContain('10.0.0.7');
    // The 990 reason is the generic one too.
    expect(read990(firstTransaction(result.ack!)).reason).toBe('Tender could not be processed');
    // …while the full detail IS journalled, and only there.
    const update = h.updates.at(-1);
    expect(update.error).toContain('ECONNREFUSED');
    expect(update.parsed.publicError).toBe('Tender could not be processed');
  });

  it('204: a deliberate decline keeps its business wording', async () => {
    const h = harness({ config: { customerId: '' } });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: fixture('204-minimal.edi'),
    });
    expect(result.error).toBe('No customerId on the EDI integration');
    expect(h.updates.at(-1).error).toBe('No customerId on the EDI integration');
  });

  it('210: an unexpected error is reported generically', async () => {
    const h = harness({
      explodeWith: 'Invalid `prisma.incomingCarrierInvoice.create()` invocation',
    });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-carrier',
      content: fixture('210-invoice.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Interchange could not be processed');
    expect(h.updates.at(-1).error).toContain('prisma.incomingCarrierInvoice');
  });

  it('210: the same carrier invoice number is refused as a duplicate', async () => {
    const h = harness({ duplicateInvoice: true });
    const result = await h.svc.receive(TENANT, {
      integrationKey: 'edi-carrier',
      content: fixture('210-invoice.edi'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Duplicate carrier invoice INV-77410');
    expect(h.invoices).toHaveLength(0);
  });

  it('a replay answers with the stored 990 and the stored partner-safe reason', async () => {
    const h = harness({ explodeWith: 'internal detail 10.0.0.7' });
    const content = fixture('204-minimal.edi');
    const first = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });
    const replay = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });

    expect(replay.replayed).toBe(true);
    expect(replay.inboxId).toBe(first.inboxId);
    expect(replay.error).toBe('Tender could not be processed');
    expect(replay.ack).toBe(first.ack);
    expect(JSON.stringify(replay)).not.toContain('10.0.0.7');
  });

  it('shares one dedup namespace, computed on the trimmed interchange', async () => {
    const h = harness();
    const content = fixture('204-minimal.edi');
    const first = await h.svc.receive(TENANT, { integrationKey: 'edi-acme', content });
    // Trailing whitespace must NOT produce a second inbox row.
    const second = await h.svc.receive(TENANT, {
      integrationKey: 'edi-acme',
      content: `${content}

`,
    });
    expect(second.inboxId).toBe(first.inboxId);
    expect(second.replayed).toBe(true);
    expect(h.inbox).toHaveLength(1);
    expect(h.inbox[0].dedupKey).toBe(ediDedupKey(content));
  });
});

describe('EdiService — 214 outbound status', () => {
  it('builds the AT7 chain oldest-first and closes on the current status', async () => {
    const h = harness();
    const built = await h.svc.build214ForShipment(TENANT, 'ship_1', 'edi-acme');
    const status = read214(firstTransaction(built.x12));

    expect(status.shipmentId).toBe('SH-000042');
    expect(status.scac).toBe('CRXY');
    // DISPATCHED → AM, DEPARTED_STOP at a pickup → AF, DELIVERED → D1.
    // The shipment status is DELIVERED (D1) too, and is NOT duplicated.
    expect(status.events.map((e) => e.code)).toEqual(['AM', 'AF', 'D1']);
    expect(status.events[0].city).toBe('Montreal');
    expect(status.events.at(-1)!.city).toBe('Toronto');
    expect(status.references.map((r) => r.value)).toEqual(['TO-000007', 'PO-88231', 'LD-000003']);
    expect(built.eventCount).toBe(3);
  });

  it('refuses to send when the integration has no outbound url', async () => {
    const h = harness();
    await expect(h.svc.send214(TENANT, 'user_1', 'ship_1', 'edi-acme')).rejects.toThrow(/url/);
    // A form posts every field: a blank url is "not configured", not a target.
    const blank = harness({ config: { url: '   ' } });
    await expect(blank.svc.send214(TENANT, 'user_1', 'ship_1', 'edi-acme')).rejects.toThrow(/url/);
  });

  it('falls back to the ISA ids when the GS ids are saved blank', async () => {
    const h = harness({ config: { gsSenderId: '', gsReceiverId: '   ' } });
    const built = await h.svc.build214ForShipment(TENANT, 'ship_1', 'edi-acme');
    const gs = parseX12(built.x12).document!.groups[0].gs;
    // GS02 / GS03 must never go out empty.
    expect(gs.elements[1]).toBe('PULSARTMS');
    expect(gs.elements[2]).toBe('ACMESHIPPER');
  });

  it('queues the 214 on the webhook outbox when a url is configured', async () => {
    const h = harness({ config: { url: 'https://partner.example.com/edi' } });
    const result = await h.svc.send214(TENANT, 'user_1', 'ship_1', 'edi-acme');
    expect(result.deliveryId).toBe('del_1');
    const [, integrationId, event, data] = h.deliveries[0];
    expect(integrationId).toBe('int_1');
    expect(event).toBe('shipment.214');
    expect(String((data as any).x12)).toContain('ST*214*');
    expect(h.audits.some((a) => a.after?.action === 'edi-214-send')).toBe(true);
  });
});
