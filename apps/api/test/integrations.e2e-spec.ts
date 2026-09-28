/**
 * E2E outbound integrations (task C1) — the domain-event → webhook bridge.
 *
 *   S1  real test    POST /integrations/:id/test on a `webhook*` integration performs a
 *                    REAL signed `ping` POST against the configured URL.
 *   S2  catalog      GET /integrations/events documents every business event.
 *   S3  bridge       a business event (connect.import-batch.completed, emitted by a CSV
 *                    import) reaches the local endpoint through the outbox (rule 55).
 *   S4  replay       POST /integrations/:id/deliveries/:deliveryId/replay re-sends it.
 *   S5  formats      config.format = 'slack' ships a Slack incoming-webhook body.
 *   S7  studio keys  an integration configured with endpointUrl/webhookSecret delivers too.
 *   S8  egress guard a non-http scheme is refused at write time.
 *
 * Every request is captured by an http.createServer bound to an ephemeral port in this
 * process, so the suite is fully offline. HMAC signatures are verified against the raw body.
 *
 * Permission core.integrations.read|manage; no module gate on /integrations.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhooksService } from '../src/core/integrations/webhooks.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const SECRET = 'e2e-webhook-secret';
const EVENT = 'connect.import-batch.completed';

interface Captured {
  headers: Record<string, string>;
  body: string;
}

describe('Outbound integrations: events → webhooks (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let hookServer: Server;
  let hookUrl = '';
  const received: Captured[] = [];

  const suffix = `${Date.now()}`;
  const jsonKey = `webhook-test-json-${suffix}`;
  const slackKey = `webhook-test-slack-${suffix}`;
  const studioKey = `webhook-test-studio-${suffix}`;
  const redirectKey = `webhook-test-redirect-${suffix}`;
  const previousPrivateFlag = process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let jsonIntegrationId = '';
  let slackIntegrationId = '';
  let studioIntegrationId = '';

  const signatureOf = (body: string) =>
    'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');

  /** Poll until `predicate` holds or the budget runs out (the bridge is fire-and-forget). */
  async function waitFor(predicate: () => boolean, budgetMs = 15000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return predicate();
  }

  async function runImport(code: string) {
    const csv = `Code,Name\n${code},Integration Bridge ${code}\n`;
    return request(http)
      .post('/api/v1/connect/imports')
      .set(auth())
      .field('target', 'carriers')
      .field('mapping', JSON.stringify({ code: 'Code', name: 'Name' }))
      .attach('file', Buffer.from(csv), { filename: 'bridge.csv', contentType: 'text/csv' })
      .expect(201);
  }

  const carrierCodes = [`INTG-C1-${suffix}`, `INTG-C2-${suffix}`];

  beforeAll(async () => {
    // The endpoint is a loopback server: the SSRF guard must be relaxed, exactly
    // as a developer would do locally (WEBHOOK_ALLOW_PRIVATE_URLS=true).
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';

    hookServer = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(307, { Location: '/should-not-receive-secrets' });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        received.push({
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.integration
        .deleteMany({ where: { key: { in: [jsonKey, slackKey, studioKey, redirectKey] } } })
        .catch(() => undefined);
      await prisma.carrier
        .deleteMany({ where: { code: { in: carrierCodes } } })
        .catch(() => undefined);
    }
    await app?.close();
    await new Promise<void>((resolve) => hookServer.close(() => resolve()));
    if (previousPrivateFlag === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
    else process.env.WEBHOOK_ALLOW_PRIVATE_URLS = previousPrivateFlag;
  });

  it('S0: creates two ENABLED webhook integrations pointing at the local endpoint', async () => {
    const json = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: jsonKey,
        name: 'E2E webhook (json)',
        status: 'ENABLED',
        config: { url: hookUrl, secret: SECRET, format: 'json', events: [EVENT] },
      })
      .expect(201);
    jsonIntegrationId = (json.body as { id: string }).id;
    // Secrets are never echoed back in clear (masking).
    expect((json.body as { config: Record<string, unknown> }).config.secret).toBe('***');

    const slack = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: slackKey,
        name: 'E2E webhook (slack)',
        status: 'ENABLED',
        config: { url: hookUrl, format: 'slack', events: [EVENT] },
      })
      .expect(201);
    slackIntegrationId = (slack.body as { id: string }).id;

    // Same destination, expressed with the integrations-studio config spelling.
    const studio = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: studioKey,
        name: 'E2E webhook (studio keys)',
        status: 'ENABLED',
        config: { endpointUrl: hookUrl, webhookSecret: SECRET, events: [EVENT] },
      })
      .expect(201);
    studioIntegrationId = (studio.body as { id: string }).id;
  });

  it('S8: a non-http destination is refused at write time (egress guard)', async () => {
    await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `${jsonKey}-bad`,
        name: 'E2E webhook (bad scheme)',
        config: { url: 'file:///etc/passwd' },
      })
      .expect(400);
  });

  it('S7: the studio spelling (endpointUrl/webhookSecret) is pinged and signed', async () => {
    received.length = 0;
    const res = await request(http)
      .post(`/api/v1/integrations/${studioIntegrationId}/test`)
      .set(auth())
      .expect(201);
    expect((res.body as { status: string; live: boolean }).status).toBe('ok');
    expect((res.body as { live: boolean }).live).toBe(true);

    expect(received).toHaveLength(1);
    expect(received[0].headers['x-pulsar-event']).toBe('ping');
    expect(received[0].headers['x-pulsar-signature']).toBe(signatureOf(received[0].body));
  });

  it('S1: POST :id/test really pings the endpoint with a signed ping', async () => {
    received.length = 0;
    const res = await request(http)
      .post(`/api/v1/integrations/${jsonIntegrationId}/test`)
      .set(auth())
      .expect(201);

    const report = res.body as {
      status: string;
      live: boolean;
      statusCode?: number;
      summary: string;
    };
    expect(report.live).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.statusCode).toBe(200);
    expect(report.summary).not.toContain('bientôt');

    expect(received).toHaveLength(1);
    const ping = received[0];
    expect(ping.headers['x-pulsar-event']).toBe('ping');
    expect(ping.headers['x-pulsar-signature']).toBe(signatureOf(ping.body));
    expect(JSON.parse(ping.body)).toMatchObject({ event: 'ping' });
    // Historical envelope: no deliveryId in the body, it is a header.
    expect(JSON.parse(ping.body).deliveryId).toBeUndefined();
    expect(ping.headers['x-pulsar-delivery']).toBe('test');
  });

  it('S1c: a partial PATCH (name only) merges — url and secret survive the save', async () => {
    // The Studio form posts only the fields it knows: a replacing PATCH would
    // wipe `url`/`secret` and leave the connector pointing nowhere, unsigned.
    await request(http)
      .patch(`/api/v1/integrations/${jsonIntegrationId}`)
      .set(auth())
      .send({ name: 'E2E webhook (renamed)' })
      .expect(200);

    const list = await request(http).get('/api/v1/integrations').set(auth()).expect(200);
    const row = (
      list.body as Array<{ id: string; name: string; config: Record<string, unknown> }>
    ).find((i) => i.id === jsonIntegrationId);
    expect(row?.name).toBe('E2E webhook (renamed)');
    expect(row?.config.url).toBe(hookUrl);
    expect(row?.config.secret).toBe('***'); // still set, still masked

    received.length = 0;
    const res = await request(http)
      .post(`/api/v1/integrations/${jsonIntegrationId}/test`)
      .set(auth())
      .expect(201);
    expect((res.body as { status: string }).status).toBe('ok');
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-pulsar-signature']).toBe(signatureOf(received[0].body));
  });

  it('S1b: a webhook integration without a URL reports a blocked live test', async () => {
    const created = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({ key: `${jsonKey}-nourl`, name: 'E2E webhook (no url)', config: {} })
      .expect(201);
    const id = (created.body as { id: string }).id;

    const res = await request(http).post(`/api/v1/integrations/${id}/test`).set(auth()).expect(201);
    expect((res.body as { status: string; live: boolean }).status).toBe('blocked');
    expect((res.body as { live: boolean }).live).toBe(true);

    await prisma.integration.delete({ where: { id } }).catch(() => undefined);
  });

  it('S2: GET /integrations/events documents the business events', async () => {
    const res = await request(http).get('/api/v1/integrations/events').set(auth()).expect(200);
    const catalog = res.body as Array<{
      type: string;
      module: string;
      description: string;
      example: unknown;
    }>;
    expect(catalog.length).toBeGreaterThan(20);
    const entry = catalog.find((e) => e.type === EVENT);
    expect(entry).toBeDefined();
    expect(entry!.description.length).toBeGreaterThan(10);
    expect(entry!.example).toBeTruthy();
  });

  it('S3: a business event reaches the endpoint through the outbox (rule 55)', async () => {
    received.length = 0;
    await runImport(carrierCodes[0]);

    const gotJson = await waitFor(() =>
      received.some((r) => {
        if (r.headers['x-pulsar-event'] !== EVENT) return false;
        return r.headers['content-type'] === 'application/json' && r.body.startsWith('{"event"');
      }),
    );
    expect(gotJson).toBe(true);

    const delivery = received.find(
      (r) => r.headers['x-pulsar-event'] === EVENT && r.body.startsWith('{"event"'),
    )!;
    expect(delivery.headers['x-pulsar-signature']).toBe(signatureOf(delivery.body));
    const envelope = JSON.parse(delivery.body) as {
      event: string;
      occurredAt: string;
      data: { target: string; importedRows: number };
    };
    expect(Object.keys(envelope)).toEqual(['event', 'occurredAt', 'data']);
    expect(envelope.event).toBe(EVENT);
    expect(envelope.data.target).toBe('carriers');
    expect(envelope.data.importedRows).toBe(1);
  });

  it('S5: the slack-format integration receives a Slack incoming-webhook body', async () => {
    const gotSlack = await waitFor(() =>
      received.some((r) => r.headers['x-pulsar-event'] === EVENT && r.body.includes('"blocks"')),
    );
    expect(gotSlack).toBe(true);

    const slackBody = JSON.parse(received.find((r) => r.body.includes('"blocks"'))!.body) as {
      text: string;
      blocks: Array<{ text: { text: string } }>;
    };
    expect(slackBody.text).toContain(EVENT);
    expect(slackBody.blocks[0].text.text).toContain('target');
    // No secret on that integration → unsigned delivery.
    expect(
      received.find((r) => r.body.includes('"blocks"'))!.headers['x-pulsar-signature'],
    ).toBeUndefined();
  });

  it('S4: replaying a delivery re-sends it and resets its attempt counter', async () => {
    const list = await request(http)
      .get(`/api/v1/integrations/${jsonIntegrationId}/deliveries`)
      .set(auth())
      .expect(200);
    const deliveries = list.body as Array<{ id: string; event: string; status: string }>;
    const target = deliveries.find((d) => d.event === EVENT);
    expect(target).toBeDefined();

    received.length = 0;
    const replay = await request(http)
      .post(`/api/v1/integrations/${jsonIntegrationId}/deliveries/${target!.id}/replay`)
      .set(auth())
      .expect(201);
    expect((replay.body as { status: string }).status).toBe('DELIVERED');

    const resent = await waitFor(
      () => received.some((r) => r.headers['x-pulsar-delivery'] === target!.id),
      5000,
    );
    expect(resent).toBe(true);
  });

  it('S4b: replaying a delivery of another integration is a 404', async () => {
    const list = await request(http)
      .get(`/api/v1/integrations/${jsonIntegrationId}/deliveries`)
      .set(auth())
      .expect(200);
    const target = (list.body as Array<{ id: string }>)[0];
    await request(http)
      .post(`/api/v1/integrations/${slackIntegrationId}/deliveries/${target.id}/replay`)
      .set(auth())
      .expect(404);
  });

  it('S6: a DISABLED integration stops receiving deliveries', async () => {
    await request(http)
      .patch(`/api/v1/integrations/${jsonIntegrationId}`)
      .set(auth())
      .send({ status: 'DISABLED' })
      .expect(200);
    for (const id of [slackIntegrationId, studioIntegrationId]) {
      await request(http)
        .patch(`/api/v1/integrations/${id}`)
        .set(auth())
        .send({ status: 'DISABLED' })
        .expect(200);
    }

    received.length = 0;
    await runImport(carrierCodes[1]);
    // Give the (fire-and-forget) bridge a chance to misbehave before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(received.filter((r) => r.headers['x-pulsar-event'] === EVENT)).toHaveLength(0);
  });

  it('S9: disabling also suspends an existing queued delivery; reactivation preserves it', async () => {
    const integration = await prisma.integration.findUniqueOrThrow({
      where: { id: jsonIntegrationId },
    });
    const delivery = await prisma.webhookDelivery.create({
      data: {
        tenantId: integration.tenantId,
        integrationId: integration.id,
        event: EVENT,
        payload: { event: EVENT, data: { restoredQueue: true } },
      },
    });
    received.length = 0;
    await app.get(WebhooksService).attempt(delivery.id);
    expect(received).toHaveLength(0);
    expect(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    await request(http)
      .patch(`/api/v1/integrations/${integration.id}`)
      .set(auth())
      .send({ status: 'ENABLED' })
      .expect(200);
    await app.get(WebhooksService).attempt(delivery.id);
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-pulsar-delivery']).toBe(delivery.id);
    expect(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      status: 'DELIVERED',
      attempts: 1,
    });
  });

  it('S10: real ping reports a redirect without following it', async () => {
    const created = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: redirectKey,
        name: 'E2E redirect refused',
        config: { url: hookUrl.replace('/hook', '/redirect'), secret: SECRET },
      })
      .expect(201);
    received.length = 0;
    const ping = await request(http)
      .post(`/api/v1/integrations/${created.body.id}/test`)
      .set(auth())
      .expect(201);
    expect(ping.body).toMatchObject({ live: true, status: 'blocked', statusCode: 307 });
    expect(received).toHaveLength(0);
  });
});
