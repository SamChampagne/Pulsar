import type { PrismaService } from '../../prisma/prisma.service';
import type { OwnershipService } from '../../prisma/ownership.service';
import type { CryptoService } from '../crypto/crypto.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { WebhooksService } from './webhooks.service';
import { IntegrationsService, mergePreservingMasked } from './integrations.service';

const ACTOR = {
  id: 'usr_1',
  permissions: ['core.integrations.manage', 'transportation.orders.manage'],
};

/**
 * In-memory harness for the configuration WRITE paths (create/update).
 * `crypto` is identity so the stored config is readable in assertions.
 */
function harness(stored?: Record<string, unknown>) {
  const audits: any[] = [];
  const row: any = stored
    ? {
        id: 'int_1',
        tenantId: 't1',
        key: 'inbound-orders',
        name: 'Receveur commandes',
        status: 'ENABLED',
        updatedAt: new Date('2026-09-22T12:00:00.000Z'),
        inboundTokenHash: 'hash',
        config: { ...stored },
      }
    : null;
  const prisma = {
    integration: {
      findUnique: async () => null,
      // A copy, like Prisma: the service's pre-update snapshot must not alias
      // the row the update then mutates.
      findFirst: async ({ where }: any) =>
        row && where.id === row.id && where.tenantId === row.tenantId ? { ...row } : null,
      create: async ({ data }: any) => ({ id: 'int_new', ...data }),
      update: async ({ data }: any) => {
        Object.assign(row, {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.config !== undefined ? { config: data.config } : {}),
        });
        return row;
      },
    },
  } as unknown as PrismaService;
  const crypto = {
    decryptJson: (v: unknown) => v as Record<string, unknown>,
    encryptJson: (v: Record<string, unknown>) => v,
  } as unknown as CryptoService;
  const webhooks = {} as unknown as WebhooksService;
  const audit = {
    log: async (entry: any) => {
      audits.push(entry);
    },
  } as unknown as AuditLogsService;
  const config = { get: () => undefined } as any;
  const ownership = { assertOwnedIfSet: async () => {} } as unknown as OwnershipService;
  return {
    svc: new IntegrationsService(prisma, crypto, webhooks, audit, config, ownership),
    audits,
    row,
  };
}

describe('mergePreservingMasked (PATCH config semantics)', () => {
  it('merges over the stored config instead of replacing it', () => {
    const stored = { target: 'transport-order.create', inboundSecret: 's3cret', mappings: [] };
    expect(mergePreservingMasked({ label: 'Studio' }, stored)).toEqual({
      target: 'transport-order.create',
      inboundSecret: 's3cret',
      mappings: [],
      label: 'Studio',
    });
  });

  it('keeps the stored secret when the client echoes back ***', () => {
    const stored = { url: 'https://old', secret: 's3cret' };
    expect(mergePreservingMasked({ url: 'https://new', secret: '***' }, stored)).toEqual({
      url: 'https://new',
      secret: 's3cret',
    });
  });

  it('removes a key sent as null', () => {
    const stored = { target: 'transport-order.create', inboundSecret: 's3cret' };
    expect(mergePreservingMasked({ target: null }, stored)).toEqual({ inboundSecret: 's3cret' });
  });
});

describe('IntegrationsService configuration writes', () => {
  it('audits a create with the secrets masked', async () => {
    const { svc, audits } = harness();
    await svc.create(
      't1',
      {
        key: 'inbound-orders',
        name: 'Receveur commandes',
        config: { target: 'transport-order.create', inboundSecret: 'plaintext-hmac' },
      },
      ACTOR,
    );

    const entry = audits.find((a) => a.entityType === 'integration' && a.action === 'CREATE');
    expect(entry).toBeDefined();
    expect(entry.tenantId).toBe('t1');
    expect(entry.userId).toBe('usr_1');
    expect(entry.after.config.inboundSecret).toBe('***');
    expect(JSON.stringify(entry)).not.toContain('plaintext-hmac');
  });

  it('audits an update with masked before/after', async () => {
    const { svc, audits } = harness({
      target: 'transport-order.create',
      inboundSecret: 'plaintext-hmac',
    });
    await svc.update('t1', 'int_1', { name: 'Renommé' }, ACTOR);

    const entry = audits.find((a) => a.entityType === 'integration' && a.action === 'UPDATE');
    expect(entry).toBeDefined();
    expect(entry.before.name).toBe('Receveur commandes');
    expect(entry.after.name).toBe('Renommé');
    expect(entry.before.config.inboundSecret).toBe('***');
    expect(entry.after.config.inboundSecret).toBe('***');
    expect(JSON.stringify(entry)).not.toContain('plaintext-hmac');
  });

  it('a partial PATCH keeps the stored target and inbound secret', async () => {
    const { svc, row } = harness({
      target: 'transport-order.create',
      inboundSecret: 'plaintext-hmac',
      label: 'avant',
    });
    await svc.update('t1', 'int_1', { config: { label: 'après' } }, ACTOR);

    expect(row.config).toEqual({
      target: 'transport-order.create',
      inboundSecret: 'plaintext-hmac',
      label: 'après',
    });
  });

  it('a null value removes the key', async () => {
    const { svc, row } = harness({
      target: 'transport-order.create',
      inboundSecret: 'plaintext-hmac',
    });
    await svc.update('t1', 'int_1', { config: { target: null } }, ACTOR);

    expect(row.config).toEqual({ inboundSecret: 'plaintext-hmac' });
  });

  it('an echoed *** secret is preserved through the service', async () => {
    const { svc, row } = harness({
      target: 'transport-order.create',
      inboundSecret: 'plaintext-hmac',
    });
    await svc.update('t1', 'int_1', { config: { inboundSecret: '***' } }, ACTOR);

    expect(row.config.inboundSecret).toBe('plaintext-hmac');
    expect(row.config.target).toBe('transport-order.create');
  });
});
