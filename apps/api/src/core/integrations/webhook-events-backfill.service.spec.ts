import type { PrismaService } from '../../prisma/prisma.service';
import type { CryptoService } from '../crypto/crypto.service';
import { WebhookEventsBackfillService } from './webhook-events-backfill.service';

function harness(rows: Array<{ id: string; config: any }>) {
  const prisma = {
    integration: {
      findMany: async () => rows.map((r) => ({ id: r.id, config: r.config })),
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)!;
        row.config = data.config;
        return row;
      },
    },
  } as unknown as PrismaService;
  // Plaintext "encryption" — decryptJson already accepts legacy plain objects.
  const crypto = {
    decryptJson: (v: unknown) => (v ?? {}) as Record<string, unknown>,
    encryptJson: (v: Record<string, unknown>) => v,
  } as unknown as CryptoService;
  return { svc: new WebhookEventsBackfillService(prisma, crypto), rows };
}

describe('WebhookEventsBackfillService', () => {
  it('pins the legacy allowlist on a webhook integration without events', async () => {
    const { svc, rows } = harness([{ id: 'i1', config: { url: 'https://a.example.com' } }]);

    expect(await svc.backfill()).toBe(1);
    expect(rows[0].config.events).toEqual([
      'load.dispatched',
      'load.completed',
      'tender.sent',
      'tender.accepted',
      'tender.declined',
      'tender.expired',
    ]);
    expect(typeof rows[0].config.eventsBackfilledAt).toBe('string');
    // Other config keys survive.
    expect(rows[0].config.url).toBe('https://a.example.com');
  });

  it('treats an empty array like a missing allowlist', async () => {
    const { svc, rows } = harness([{ id: 'i1', config: { url: 'https://a', events: [] } }]);
    expect(await svc.backfill()).toBe(1);
    expect(rows[0].config.events).toHaveLength(6);
  });

  it('never touches an explicit allowlist', async () => {
    const { svc, rows } = harness([
      { id: 'i1', config: { url: 'https://a', events: ['wms.pick.completed'] } },
    ]);
    expect(await svc.backfill()).toBe(0);
    expect(rows[0].config.events).toEqual(['wms.pick.completed']);
    expect(rows[0].config.eventsBackfilledAt).toBeUndefined();
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { svc, rows } = harness([{ id: 'i1', config: { url: 'https://a' } }]);
    expect(await svc.backfill()).toBe(1);
    const stamped = rows[0].config.eventsBackfilledAt;

    expect(await svc.backfill()).toBe(0);
    expect(rows[0].config.eventsBackfilledAt).toBe(stamped);
  });

  it('skips an already-marked row even when its allowlist was cleared on purpose', async () => {
    const { svc, rows } = harness([
      { id: 'i1', config: { url: 'https://a', events: [], eventsBackfilledAt: '2026-09-17' } },
    ]);
    expect(await svc.backfill()).toBe(0);
    expect(rows[0].config.events).toEqual([]);
  });

  it('skips an unreadable config instead of throwing', async () => {
    const prisma = {
      integration: {
        findMany: async () => [{ id: 'i1', config: 'enc:v1:broken' }],
        update: async () => {
          throw new Error('should not be called');
        },
      },
    } as unknown as PrismaService;
    const crypto = {
      decryptJson: () => {
        throw new Error('bad key');
      },
      encryptJson: (v: Record<string, unknown>) => v,
    } as unknown as CryptoService;

    await expect(new WebhookEventsBackfillService(prisma, crypto).backfill()).resolves.toBe(0);
  });

  it('onApplicationBootstrap never throws', async () => {
    const prisma = {
      integration: {
        findMany: async () => {
          throw new Error('db down');
        },
      },
    } as unknown as PrismaService;
    const svc = new WebhookEventsBackfillService(prisma, {} as CryptoService);
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
