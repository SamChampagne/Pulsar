import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CryptoService } from '../crypto/crypto.service';
import { IntegrationsService } from './integrations.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { WebhooksService } from './webhooks.service';

function harness(delivery: any | null, options: { allowPrivate?: boolean } = {}) {
  const updates: any[] = [];
  const attempted: string[] = [];
  const audits: any[] = [];
  const prisma = {
    webhookDelivery: {
      findFirst: async ({ where }: any) => {
        if (!delivery) return null;
        if (where.tenantId !== delivery.tenantId) return null;
        if (where.integrationId !== delivery.integrationId) return null;
        if (where.id !== delivery.id) return null;
        return { id: delivery.id };
      },
      updateMany: async ({ where, data }: any) => {
        if (!delivery) return { count: 0 };
        if (where.status?.not && delivery.status === where.status.not) return { count: 0 };
        updates.push({ where, data });
        Object.assign(delivery, data);
        return { count: 1 };
      },
      findUnique: async () => delivery,
    },
    integration: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: 'int_new', ...data }),
    },
  } as unknown as PrismaService;
  const crypto = {
    decryptJson: () => ({}),
    encryptJson: (v: Record<string, unknown>) => v,
  } as unknown as CryptoService;
  const webhooks = {
    attempt: async (id: string) => {
      attempted.push(id);
    },
  } as unknown as WebhooksService;
  const audit = {
    log: async (entry: any) => {
      audits.push(entry);
    },
  } as unknown as AuditLogsService;
  const config = {
    get: (key: string) =>
      key === 'WEBHOOK_ALLOW_PRIVATE_URLS' && options.allowPrivate ? 'true' : undefined,
  } as any;
  return {
    svc: new IntegrationsService(prisma, crypto, webhooks, audit, config),
    updates,
    attempted,
    audits,
  };
}

const DELIVERY = {
  id: 'dlv_1',
  tenantId: 't1',
  integrationId: 'int_1',
  status: 'FAILED',
  attempts: 5,
  lastError: 'HTTP 500',
  deliveredAt: null,
};

describe('IntegrationsService.replayDelivery', () => {
  it('claims the delivery conditionally, retries it inline and audits the replay', async () => {
    const { svc, updates, attempted, audits } = harness({ ...DELIVERY });

    await svc.replayDelivery('t1', 'int_1', 'dlv_1', 'user_1');

    expect(updates).toHaveLength(1);
    expect(updates[0].where).toMatchObject({
      id: 'dlv_1',
      tenantId: 't1',
      integrationId: 'int_1',
      status: { not: 'PENDING' },
    });
    expect(updates[0].data).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
    // deliveredAt records the last successful delivery — a replay never wipes it.
    expect('deliveredAt' in updates[0].data).toBe(false);
    expect(updates[0].data.nextAttemptAt).toBeInstanceOf(Date);
    expect(attempted).toEqual(['dlv_1']);
    expect(audits[0]).toMatchObject({
      tenantId: 't1',
      userId: 'user_1',
      entityType: 'integration',
      entityId: 'int_1',
      after: { action: 'replay', deliveryId: 'dlv_1' },
    });
  });

  it('409s when the delivery is already queued (concurrent replay)', async () => {
    const { svc, attempted } = harness({ ...DELIVERY, status: 'PENDING' });
    await expect(svc.replayDelivery('t1', 'int_1', 'dlv_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(attempted).toHaveLength(0);
  });

  it('404s for another tenant (tenant scope, rule 1)', async () => {
    const { svc, attempted } = harness({ ...DELIVERY });
    await expect(svc.replayDelivery('other-tenant', 'int_1', 'dlv_1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(attempted).toHaveLength(0);
  });

  it('404s for an unknown delivery', async () => {
    const { svc } = harness(null);
    await expect(svc.replayDelivery('t1', 'int_1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('IntegrationsService webhook URL guard', () => {
  it('refuses a private endpoint on create', async () => {
    const { svc } = harness(null);
    await expect(
      svc.create('t1', { key: 'webhook-x', name: 'X', config: { url: 'http://127.0.0.1/h' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-http scheme, even with the private escape hatch on', async () => {
    const { svc } = harness(null, { allowPrivate: true });
    await expect(
      svc.create('t1', { key: 'webhook-x', name: 'X', config: { url: 'file:///etc/passwd' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a private endpoint when WEBHOOK_ALLOW_PRIVATE_URLS=true', async () => {
    const { svc } = harness(null, { allowPrivate: true });
    await expect(
      svc.create('t1', { key: 'webhook-x', name: 'X', config: { url: 'http://127.0.0.1/h' } }),
    ).resolves.toBeTruthy();
  });

  it('checks the studio spelling too (endpointUrl)', async () => {
    const { svc } = harness(null);
    await expect(
      svc.create('t1', {
        key: 'webhook-x',
        name: 'X',
        config: { endpointUrl: 'http://10.0.0.8/h' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores non-webhook integrations', async () => {
    const { svc } = harness(null);
    await expect(
      svc.create('t1', { key: 'erp-odoo', name: 'Odoo', config: { url: 'http://10.0.0.8/h' } }),
    ).resolves.toBeTruthy();
  });
});

describe('IntegrationsService.eventCatalog', () => {
  it('exposes the shared domain-event catalog', () => {
    const { svc } = harness(null);
    const catalog = svc.eventCatalog();
    expect(catalog.length).toBeGreaterThan(20);
    expect(catalog.find((e) => e.type === 'load.completed')).toMatchObject({
      module: 'TRANSPORTATION',
    });
  });
});

/** Harness for tests that need `update()` on a specific stored integration row. */
function updateHarness(integration: { id: string; tenantId: string; key: string; config: any }) {
  const updates: any[] = [];
  const prisma = {
    integration: {
      findFirst: async ({ where }: any) => {
        if (where.id !== integration.id || where.tenantId !== integration.tenantId) return null;
        return { ...integration };
      },
      update: async ({ where, data }: any) => {
        updates.push({ where, data });
        Object.assign(integration, data);
        return { ...integration };
      },
    },
  } as unknown as PrismaService;
  const crypto = {
    // Plaintext "encryption" for the harness — config passes through as-is.
    decryptJson: (v: unknown) => (v ?? {}) as Record<string, unknown>,
    encryptJson: (v: Record<string, unknown>) => v,
  } as unknown as CryptoService;
  const webhooks = {} as unknown as WebhooksService;
  const audit = { log: async () => {} } as unknown as AuditLogsService;
  const config = { get: () => undefined } as any;
  return {
    svc: new IntegrationsService(prisma, crypto, webhooks, audit, config),
    updates,
    integration,
  };
}

describe('IntegrationsService.update — eventsBackfilledAt stamping (finding B)', () => {
  it('stamps eventsBackfilledAt when PATCHing a webhook config that never had one', async () => {
    const { svc, integration } = updateHarness({
      id: 'int_1',
      tenantId: 't1',
      key: 'webhook-x',
      config: { url: 'https://hooks.example.com/in' },
    });

    // Explicitly clears the allowlist — this must NOT be re-widened later by
    // WebhookEventsBackfillService, so the stamp must land now.
    await svc.update('t1', 'int_1', {
      config: { url: 'https://hooks.example.com/in', events: [] },
    });

    expect(integration.config.events).toEqual([]);
    expect(typeof integration.config.eventsBackfilledAt).toBe('string');
  });

  it('preserves an already-stamped value instead of overwriting it', async () => {
    const { svc, integration } = updateHarness({
      id: 'int_1',
      tenantId: 't1',
      key: 'webhook-x',
      config: {
        url: 'https://hooks.example.com/in',
        events: [],
        eventsBackfilledAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await svc.update('t1', 'int_1', {
      config: { url: 'https://hooks.example.com/in', events: [] },
    });

    expect(integration.config.eventsBackfilledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not stamp non-webhook integrations', async () => {
    const { svc, integration } = updateHarness({
      id: 'int_1',
      tenantId: 't1',
      key: 'erp-odoo',
      config: { url: 'https://erp.example.com' },
    });

    await svc.update('t1', 'int_1', { config: { url: 'https://erp.example.com/v2' } });

    expect(integration.config.eventsBackfilledAt).toBeUndefined();
  });
});
