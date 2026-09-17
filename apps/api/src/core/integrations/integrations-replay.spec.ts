import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CryptoService } from '../crypto/crypto.service';
import { IntegrationsService } from './integrations.service';
import type { WebhooksService } from './webhooks.service';

function harness(delivery: any | null) {
  const updates: any[] = [];
  const attempted: string[] = [];
  const prisma = {
    webhookDelivery: {
      findFirst: async ({ where }: any) => {
        if (!delivery) return null;
        if (where.tenantId !== delivery.tenantId) return null;
        if (where.integrationId !== delivery.integrationId) return null;
        if (where.id !== delivery.id) return null;
        return { id: delivery.id };
      },
      update: async (args: any) => {
        updates.push(args);
        Object.assign(delivery, args.data);
        return delivery;
      },
      findUnique: async () => delivery,
    },
    integration: { findFirst: async () => null },
  } as unknown as PrismaService;
  const crypto = { decryptJson: () => ({}) } as unknown as CryptoService;
  const webhooks = {
    attempt: async (id: string) => {
      attempted.push(id);
    },
  } as unknown as WebhooksService;
  return { svc: new IntegrationsService(prisma, crypto, webhooks), updates, attempted };
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
  it('resets the delivery and retries it inline', async () => {
    const { svc, updates, attempted } = harness({ ...DELIVERY });

    await svc.replayDelivery('t1', 'int_1', 'dlv_1');

    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      deliveredAt: null,
    });
    expect(updates[0].data.nextAttemptAt).toBeInstanceOf(Date);
    expect(attempted).toEqual(['dlv_1']);
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
