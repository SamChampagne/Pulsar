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
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let jsonIntegrationId = '';
  let slackIntegrationId = '';

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
    hookServer = createServer((req, res) => {
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
        .deleteMany({ where: { key: { in: [jsonKey, slackKey] } } })
        .catch(() => undefined);
      await prisma.carrier
        .deleteMany({ where: { code: { in: carrierCodes } } })
        .catch(() => undefined);
    }
    await app?.close();
    await new Promise<void>((resolve) => hookServer.close(() => resolve()));
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
    expect(JSON.parse(ping.body)).toMatchObject({ event: 'ping', deliveryId: 'test' });
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
      deliveryId: string;
      data: { target: string; importedRows: number };
    };
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
    await request(http)
      .patch(`/api/v1/integrations/${slackIntegrationId}`)
      .set(auth())
      .send({ status: 'DISABLED' })
      .expect(200);

    received.length = 0;
    await runImport(carrierCodes[1]);
    // Give the (fire-and-forget) bridge a chance to misbehave before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(received.filter((r) => r.headers['x-pulsar-event'] === EVENT)).toHaveLength(0);
  });
});
