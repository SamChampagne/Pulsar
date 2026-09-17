import { createHmac } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CryptoService } from '../crypto/crypto.service';
import { WebhooksService } from './webhooks.service';

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function harness(config: Record<string, unknown>, ok = true) {
  const calls: FetchCall[] = [];
  const updates: any[] = [];
  const delivery = {
    id: 'dlv_1',
    tenantId: 't1',
    integrationId: 'int_1',
    event: 'load.completed',
    status: 'PENDING',
    attempts: 0,
    createdAt: new Date('2026-09-17T11:00:00.000Z'),
    payload: {
      event: 'load.completed',
      occurredAt: '2026-09-17T12:00:00.000Z',
      data: { loadId: 'ld_1', loadNumber: 'LD-000045' },
    },
    integration: { id: 'int_1', key: 'webhook-main', config: 'enc' },
  };
  const prisma = {
    webhookDelivery: {
      findUnique: async () => delivery,
      update: async (args: any) => {
        updates.push(args);
        return delivery;
      },
    },
  } as unknown as PrismaService;
  const crypto = { decryptJson: () => config } as unknown as CryptoService;

  global.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok, status: ok ? 200 : 500 };
  }) as unknown as typeof fetch;

  return { svc: new WebhooksService(prisma, crypto), calls, updates };
}

describe('WebhooksService delivery formats', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the canonical JSON envelope by default and signs it', async () => {
    const { svc, calls } = harness({ url: 'https://hook.example.com/in', secret: 's3cr3t' });
    await svc.attempt('dlv_1');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hook.example.com/in');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(calls[0].init.headers['X-Pulsar-Event']).toBe('load.completed');
    expect(calls[0].init.headers['X-Pulsar-Delivery']).toBe('dlv_1');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      event: 'load.completed',
      deliveryId: 'dlv_1',
      occurredAt: '2026-09-17T12:00:00.000Z',
      data: { loadId: 'ld_1', loadNumber: 'LD-000045' },
    });
    const expected =
      'sha256=' + createHmac('sha256', 's3cr3t').update(calls[0].init.body).digest('hex');
    expect(calls[0].init.headers['X-Pulsar-Signature']).toBe(expected);
  });

  it('applies config.format = slack', async () => {
    const { svc, calls } = harness({ url: 'https://hooks.slack.com/x', format: 'slack' });
    await svc.attempt('dlv_1');

    const body = JSON.parse(calls[0].init.body);
    expect(body.text).toContain('load.completed —');
    expect(body.blocks[0].text.text).toContain('*loadNumber*: LD-000045');
    expect(calls[0].init.headers['X-Pulsar-Signature']).toBeUndefined();
  });

  it('applies config.format = teams', async () => {
    const { svc, calls } = harness({ url: 'https://outlook.office.com/x', format: 'teams' });
    await svc.attempt('dlv_1');
    expect(JSON.parse(calls[0].init.body)['@type']).toBe('MessageCard');
  });

  it('applies config.format = x12 with a text/plain content type', async () => {
    const { svc, calls } = harness({ url: 'https://edi.example.com', format: 'x12' });
    await svc.attempt('dlv_1');
    expect(calls[0].init.headers['Content-Type']).toBe('text/plain');
  });

  it('falls back to json for an unknown format', async () => {
    const { svc, calls } = harness({ url: 'https://hook.example.com', format: 'carrier-pigeon' });
    await svc.attempt('dlv_1');
    expect(JSON.parse(calls[0].init.body).event).toBe('load.completed');
  });

  it('marks the delivery DELIVERED on 2xx and schedules a retry on failure', async () => {
    const okRun = harness({ url: 'https://hook.example.com' });
    await okRun.svc.attempt('dlv_1');
    expect(okRun.updates[0].data.status).toBe('DELIVERED');

    const koRun = harness({ url: 'https://hook.example.com' }, false);
    await koRun.svc.attempt('dlv_1');
    expect(koRun.updates[0].data.status).toBe('PENDING');
    expect(koRun.updates[0].data.attempts).toBe(1);
    expect(koRun.updates[0].data.lastError).toContain('HTTP 500');
  });
});

describe('WebhooksService.ping', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs a signed ping and reports the status code', async () => {
    const calls: FetchCall[] = [];
    global.fetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    }) as unknown as typeof fetch;
    const svc = new WebhooksService({} as PrismaService, {} as CryptoService);

    const result = await svc.ping({ url: 'https://hook.example.com', secret: 'abc' });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(calls[0].init.headers['X-Pulsar-Event']).toBe('ping');
    const body = JSON.parse(calls[0].init.body);
    expect(body.event).toBe('ping');
    expect(body.deliveryId).toBe('test');
    expect(calls[0].init.headers['X-Pulsar-Signature']).toBe(
      'sha256=' + createHmac('sha256', 'abc').update(calls[0].init.body).digest('hex'),
    );
  });

  it('never throws on a transport failure', async () => {
    global.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const svc = new WebhooksService({} as PrismaService, {} as CryptoService);

    const result = await svc.ping({ url: 'https://nope.example.com' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('reports a missing url without any network call', async () => {
    const svc = new WebhooksService({} as PrismaService, {} as CryptoService);
    const result = await svc.ping({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('URL');
  });
});
