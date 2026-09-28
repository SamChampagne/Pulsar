import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { PERMISSION_CATALOG, SmsStatus } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { EmailConfigService } from '../src/core/email/email-config.service';
import { TelnyxTransport } from '../src/core/sms/telnyx.transport';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { ImapPollDriver } from '../src/core/email/inbound/imap-poll.driver';

describe('Communications — isolated tenant HTTP, no external sends', () => {
  let app: INestApplication, db: PrismaService, tenantId: string, foreignId: string;
  const slug = `communications-${Date.now()}`;
  const actors: Record<string, { id: string; token: string }> = {};
  const keypair = generateKeyPairSync('ed25519');
  const webhookPublicKey = keypair.publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64');
  const imapTest = jest.fn(async () => ({ ok: true }));
  const smsSend = jest.fn(async () => ({
    status: SmsStatus.ACCEPTED,
    providerMessageId: String(randomUUID()),
  }));
  const emailSend = jest.fn(async () => true);
  const config = {
    fromNumber: '+15145550123',
    messagingProfileId: randomUUID(),
    live: false,
    active: true,
    dailyLimit: 100,
    webhookPublicKey,
    webhookOrigin: 'https://pulsar.example.test',
  };
  const call = (method: 'get' | 'post' | 'put', path: string, body?: object, role = 'manager') =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .auth(actors[role].token, { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ channel: 'log', send: emailSend })
      .overrideProvider(TelnyxTransport)
      .useValue({ send: smsSend })
      .overrideProvider(ImapPollDriver)
      .useValue({ testConnection: imapTest, fetchNew: jest.fn(async () => []) })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    db = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    tenantId = (await db.tenant.create({ data: { slug, name: slug } })).id;
    foreignId = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (const [name, keys] of Object.entries({
      manager: PERMISSION_CATALOG.map((p) => p.key),
      reader: ['core.sms.read'],
      sender: ['core.sms.read', 'core.sms.send'],
      blind: ['core.sms.manage'],
      other: ['core.sms.read', 'core.sms.send', 'core.sms.manage'],
    })) {
      const tid = name === 'other' ? foreignId : tenantId;
      const permissions = await db.permission.findMany({ where: { key: { in: keys } } });
      const role = await db.role.create({
        data: {
          tenantId: tid,
          key: name,
          name,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      const user = await db.user.create({
        data: {
          tenantId: tid,
          email: `${name}@${slug}.test`,
          firstName: name,
          lastName: 'Recette',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenant: name === 'other' ? `${slug}-other` : slug,
          email: user.email,
          password: 'Test1234!',
        })
        .expect(200);
      actors[name] = { id: user.id, token: res.body.accessToken };
    }
    console.log(`COMMUNICATIONS_TENANT=${slug}`);
  }, 120000);
  afterAll(async () => {
    if (app) {
      app.get(ConfigService).set('SMS_DRIVER', 'log');
      await app.close();
    }
  });
  async function configure(overrides: object = {}) {
    const current = (await call('get', 'sms/connection').expect(200)).body.config;
    return (
      await call('put', 'sms/config', {
        ...config,
        expectedUpdatedAt: current?.updatedAt ?? null,
        confirmLive: true,
        ...overrides,
      }).expect(200)
    ).body;
  }
  async function intent() {
    const current = (await call('get', 'sms/connection').expect(200)).body.config;
    return {
      operationKey: randomUUID(),
      expectedUpdatedAt: current.updatedAt,
      toNumber: '+15145550456',
      text: 'Votre intervention est prévue demain.',
      confirmed: true,
    };
  }
  beforeEach(() => {
    smsSend.mockClear();
    emailSend.mockClear();
    app.get(ConfigService).set('SMS_DRIVER', 'log');
  });
  it('works without business modules and keeps the encrypted key out of API and audits', async () => {
    const row = await configure({ apiKey: 'fake-key-not-a-real-credential' });
    expect(row.apiKeyEnc).toBeUndefined();
    const saved = await db.tenantSmsConfig.findUniqueOrThrow({ where: { tenantId } });
    expect(saved.apiKeyEnc).not.toContain('fake-key-not-a-real-credential');
    expect((await call('get', 'sms/connection').expect(200)).body.config.hasApiKey).toBe(true);
    expect(JSON.stringify((await call('get', 'sms/connection')).body)).not.toContain('apiKeyEnc');
    expect(
      JSON.stringify(await db.auditLog.findMany({ where: { tenantId, entityType: 'sms-config' } })),
    ).not.toContain('fake-key-not-a-real-credential');
  });
  it('separates permissions and tenant data', async () => {
    await call('put', 'sms/config', {}, 'reader').expect(403);
    await call('put', 'sms/config', {}, 'blind').expect(403);
    await call('post', 'sms/messages', {}, 'reader').expect(403);
    expect(
      (await call('get', 'sms/connection', undefined, 'other').expect(200)).body.config,
    ).toBeNull();
    expect((await call('get', 'sms/messages', undefined, 'other').expect(200)).body.total).toBe(0);
  });
  it('rejects unversioned or stale config and malformed fields', async () => {
    await call('put', 'sms/config', { ...config }).expect(400);
    await call('put', 'sms/config', { ...config, expectedUpdatedAt: null }).expect(409);
    const c = await configure();
    for (const bad of [
      { fromNumber: 'abc' },
      { messagingProfileId: 'abc' },
      { dailyLimit: 0 },
      { dailyLimit: 501 },
      { tenantId: foreignId },
    ])
      await call('put', 'sms/config', { ...config, expectedUpdatedAt: c.updatedAt, ...bad }).expect(
        400,
      );
    await call('get', 'sms/messages?page=0').expect(400);
  });
  it('simulates concurrent duplicates exactly once without calling Telnyx', async () => {
    await configure();
    const body = await intent();
    const responses = await Promise.all([
      call('post', 'sms/messages', body),
      call('post', 'sms/messages', body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    const replay = await call('post', 'sms/messages', body).expect(200);
    expect(replay.body.status).toBe('SIMULATED');
    expect(replay.body.fingerprint).toBeUndefined();
    expect(smsSend).not.toHaveBeenCalled();
    expect(
      await db.smsMessage.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(1);
    await call('post', 'sms/messages', { ...body, text: 'Autre message' }).expect(409);
    await call('post', 'sms/messages', body, 'sender').expect(409);
    await configure({ active: false });
    expect((await call('post', 'sms/messages', body).expect(200)).body.id).toBe(replay.body.id);
  });
  it('validates international destination, consent and bounded message', async () => {
    await configure();
    const body = await intent();
    for (const bad of [
      { toNumber: '5141234567' },
      { text: ' ' },
      { text: 'x'.repeat(1601) },
      { confirmed: false },
      { tenantId: foreignId },
    ])
      await call('post', 'sms/messages', { ...body, ...bad }).expect(400);
    expect(smsSend).not.toHaveBeenCalled();
  });
  it('blocks paused, stale and unconfirmed real configurations before any provider call', async () => {
    await configure();
    const body = await intent();
    await configure({ active: false });
    await call('post', 'sms/messages', body).expect(400);
    await configure();
    await call('post', 'sms/messages', body).expect(409);
    const c = (await call('get', 'sms/connection')).body.config;
    await call('put', 'sms/config', {
      ...config,
      live: true,
      expectedUpdatedAt: c.updatedAt,
    }).expect(400);
    // A v1 live=true row remains unapproved after the migration.
    await db.tenantSmsConfig.update({
      where: { tenantId },
      data: { live: true, liveAuthorized: false },
    });
    await call('post', 'sms/messages', await intent()).expect(400);
    expect(smsSend).not.toHaveBeenCalled();
    const legacy = (await call('get', 'sms/connection')).body.config;
    // Suspension never requires authorizing live traffic, even for an old connection.
    await call('put', 'sms/config', {
      ...config,
      live: true,
      active: false,
      expectedUpdatedAt: legacy.updatedAt,
    }).expect(200);
  });
  it('caps the daily attempts under the same tenant lock', async () => {
    await configure({ dailyLimit: 1 });
    await call('post', 'sms/messages', await intent()).expect(400);
    expect(smsSend).not.toHaveBeenCalled();
    await configure();
  });
  it('sends with a frozen config and never resends a live replay', async () => {
    await configure({ live: true });
    app.get(ConfigService).set('SMS_DRIVER', 'log'); // No longer a tenant activation gate.
    const body = await intent();
    const r = await call('post', 'sms/messages', body).expect(200);
    expect(r.body.status).toBe('ACCEPTED');
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(smsSend.mock.calls[0]).toEqual([
      expect.any(String),
      expect.objectContaining({
        toNumber: body.toNumber,
        text: body.text,
        fromNumber: config.fromNumber,
      }),
    ]);
    await call('post', 'sms/messages', body).expect(200);
    expect(smsSend).toHaveBeenCalledTimes(1);
  });
  it('makes uncertain provider outcomes terminal, without retry', async () => {
    await configure({ live: true });
    app.get(ConfigService).set('SMS_DRIVER', 'telnyx');
    smsSend.mockResolvedValueOnce({ status: SmsStatus.UNKNOWN, providerMessageId: '' });
    const body = await intent();
    expect((await call('post', 'sms/messages', body).expect(200)).body.status).toBe('UNKNOWN');
    expect((await call('post', 'sms/messages', body).expect(200)).body.status).toBe('UNKNOWN');
    expect(smsSend).toHaveBeenCalledTimes(1);
  });
  it('rolls back an intent when its audit fails, before the external call', async () => {
    await configure({ live: true });
    app.get(ConfigService).set('SMS_DRIVER', 'telnyx');
    const body = await intent();
    const spy = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('Injected audit failure'));
    try {
      await call('post', 'sms/messages', body).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(smsSend).not.toHaveBeenCalled();
    expect(
      await db.smsMessage.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(0);
  });
  it('does not resend after provider success but failed result persistence', async () => {
    await configure({ live: true });
    app.get(ConfigService).set('SMS_DRIVER', 'telnyx');
    const body = await intent();
    const audit = app.get(AuditLogsService);
    const original = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      if (entry.entityType === 'sms-message' && entry.action === 'STATUS_CHANGE')
        throw new Error('Injected result failure');
      return original(entry, tx);
    });
    try {
      await call('post', 'sms/messages', body).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await call('post', 'sms/messages', body).expect(200)).body.status).toBe('SENDING');
    expect(smsSend).toHaveBeenCalledTimes(1);
  });
  it('stores email identity and Reply-To without returning secrets', async () => {
    const response = await call('put', 'email-config', {
      expectedUpdatedAt: null,
      host: 'smtp.example.test',
      port: 587,
      username: 'sender',
      password: 'fake-password',
      fromEmail: 'sender@example.test',
      fromName: 'Pulsar test',
      replyTo: 'replies@example.test',
      imapHost: 'imap.example.test',
      imapUsername: 'inbox',
      imapPassword: 'fake-imap-password',
    }).expect(200);
    expect(response.body.hasPassword).toBe(true);
    expect(response.body.passwordEnc).toBeUndefined();
    const resolved = await app.get(EmailConfigService).resolve(tenantId);
    expect(resolved?.replyTo).toBe('replies@example.test');
    expect(resolved?.pass).toBe('fake-password');
    await call('post', 'email-config/test', { to: 'recipient@example.test' }).expect(200);
    expect(emailSend).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ replyTo: 'replies@example.test' }),
    );
  });
  function event(type = 'message.finalized', providerMessageId = randomUUID(), text = 'Merci') {
    return {
      data: {
        id: randomUUID(),
        event_type: type,
        occurred_at: new Date().toISOString(),
        payload: {
          id: providerMessageId,
          messaging_profile_id: config.messagingProfileId,
          type: 'SMS',
          direction: type === 'message.received' ? 'inbound' : 'outbound',
          from: { phone_number: type === 'message.received' ? '+15145550999' : config.fromNumber },
          to: [
            {
              phone_number: type === 'message.received' ? config.fromNumber : '+15145550456',
              status: 'delivered',
            },
          ],
          text,
        },
      },
    };
  }
  async function webhook(
    body: ReturnType<typeof event>,
    options: { id?: string; timestamp?: string; invalid?: boolean } = {},
  ) {
    const id = options.id ?? (await call('get', 'sms/connection')).body.config.id;
    const raw = JSON.stringify(body);
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), keypair.privateKey).toString(
      'base64',
    );
    return request(app.getHttpServer())
      .post(`/api/v1/sms/webhooks/${id}`)
      .set('Content-Type', 'application/json')
      .set('telnyx-timestamp', timestamp)
      .set('telnyx-signature-ed25519', options.invalid ? 'invalid' : signature)
      .send(raw);
  }
  it('authenticates webhooks before any mutation and rejects foreign profiles', async () => {
    const body = event();
    expect((await webhook(body, { invalid: true })).status).toBe(401);
    expect(
      (await webhook(body, { timestamp: String(Math.floor(Date.now() / 1000) - 600) })).status,
    ).toBe(401);
    expect((await webhook(body, { id: 'other-tenant-config' })).status).toBe(401);
    body.data.payload.messaging_profile_id = randomUUID();
    expect((await webhook(body)).status).toBe(400);
    expect(await db.smsWebhookEvent.count({ where: { tenantId } })).toBe(0);
  });
  it('cannot bind another tenant to the same verified sender and rejects redirected evidence', async () => {
    await call('put', 'sms/config', { ...config, expectedUpdatedAt: null }, 'other').expect(409);
    const other = await call(
      'put',
      'sms/config',
      { ...config, fromNumber: '+15145550666', expectedUpdatedAt: null },
      'other',
    ).expect(200);
    expect((await webhook(event('message.received'), { id: other.body.id })).status).toBe(400);
    expect((await call('get', 'sms/inbox', undefined, 'other')).body.total).toBe(0);
  });
  it('records signed delivery exactly once without changing acceptance or configuration version', async () => {
    await configure({ live: true });
    const r = await call('post', 'sms/messages', await intent()).expect(200);
    const version = (await call('get', 'sms/connection')).body.config.updatedAt;
    const body = event('message.finalized', r.body.providerMessageId);
    expect((await webhook(body)).status).toBe(200);
    expect((await webhook(body)).status).toBe(200);
    expect(await db.smsWebhookEvent.count({ where: { tenantId, eventId: body.data.id } })).toBe(1);
    const message = await db.smsMessage.findFirstOrThrow({ where: { tenantId, id: r.body.id } });
    expect(message.status).toBe('ACCEPTED');
    expect(message.deliveryStatus).toBe('DELIVERED');
    expect((await call('get', 'sms/connection')).body.config.updatedAt).toBe(version);
    body.data.payload.to[0].status = 'delivery_failed';
    expect((await webhook(body)).status).toBe(409);
    body.data.id = randomUUID();
    expect((await webhook(body)).status).toBe(200); // Evidence retained, terminal state preserved.
    expect(
      (await db.smsMessage.findFirstOrThrow({ where: { tenantId, id: r.body.id } })).deliveryStatus,
    ).toBe('DELIVERED');
  });
  it('reconciles a receipt that arrives before the send response without a resend', async () => {
    await configure({ live: true });
    const providerMessageId = randomUUID();
    smsSend.mockImplementationOnce(async () => {
      expect((await webhook(event('message.finalized', providerMessageId))).status).toBe(200);
      return { status: SmsStatus.ACCEPTED, providerMessageId };
    });
    const r = await call('post', 'sms/messages', await intent()).expect(200);
    expect(r.body.deliveryStatus).toBe('DELIVERED');
    expect(smsSend).toHaveBeenCalledTimes(1);
  });
  it('ingests STOP atomically, keeps it across sender changes, and never treats START as opt-in', async () => {
    await configure({ active: false }); // Pausing outgoing traffic must not discard opt-outs.
    const stop = event('message.received', randomUUID(), ' STOP ');
    expect((await webhook(stop)).status).toBe(200);
    expect((await webhook(stop)).status).toBe(200);
    expect((await webhook(event('message.received', randomUUID(), 'START'))).status).toBe(200);
    await configure({ fromNumber: '+15145550777' });
    await call('post', 'sms/messages', { ...(await intent()), toNumber: '+15145550999' }).expect(
      400,
    );
    expect(smsSend).not.toHaveBeenCalled();
    expect((await call('get', 'sms/suppressions')).body.total).toBe(1);
    expect((await call('get', 'sms/inbox')).body.total).toBe(2);
    expect((await call('get', 'sms/inbox', undefined, 'other')).body.total).toBe(0);
    expect((await call('get', 'sms/suppressions', undefined, 'other')).body.total).toBe(0);
    await call('get', 'sms/inbox', undefined, 'blind').expect(403);
    await configure();
  });
  it('rolls back a STOP and its evidence if the audit cannot be persisted', async () => {
    const stop = event('message.received', randomUUID(), 'STOP');
    stop.data.payload.from.phone_number = '+15145550888';
    const spy = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('Injected webhook audit failure'));
    try {
      expect((await webhook(stop)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.smsSuppression.count({ where: { tenantId, phoneNumber: '+15145550888' } }),
    ).toBe(0);
    expect(await db.smsWebhookEvent.count({ where: { tenantId, eventId: stop.data.id } })).toBe(0);
    expect((await webhook(stop)).status).toBe(200);
  });
  it('activates real IMAP only with an in-app confirmation even when EMAIL_DRIVER is log', async () => {
    let c = (await call('get', 'email-config')).body;
    expect(c.inboundLive).toBe(false);
    await call('put', 'email-config', {
      inboundActive: true,
      expectedUpdatedAt: c.updatedAt,
    }).expect(200);
    expect((await call('post', 'email-config/test-inbound', {}).expect(200)).body.simulated).toBe(
      true,
    );
    expect(imapTest).not.toHaveBeenCalled();
    c = (await call('get', 'email-config')).body;
    await call('put', 'email-config', { inboundLive: true, expectedUpdatedAt: c.updatedAt }).expect(
      400,
    );
    await call('put', 'email-config', {
      inboundLive: true,
      confirmInboundLive: true,
      expectedUpdatedAt: c.updatedAt,
    }).expect(200);
    expect((await call('get', 'email-config/connection')).body.inbound).toBe('imap');
    expect((await call('post', 'email-config/test-inbound', {}).expect(200)).body.simulated).toBe(
      false,
    );
    expect(imapTest).toHaveBeenCalledTimes(1);
    await call('put', 'email-config', { inboundLive: false }).expect(200);
  });
  it('preserves a secret on identity edits but clears it on server/account changes', async () => {
    let c = (await call('get', 'email-config').expect(200)).body;
    c = (
      await call('put', 'email-config', {
        expectedUpdatedAt: c.updatedAt,
        fromName: 'New sender label',
      }).expect(200)
    ).body;
    expect(c.hasPassword).toBe(true);
    await call('put', 'email-config', {
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      fromName: 'stale',
    }).expect(409);
    c = (
      await call('put', 'email-config', {
        expectedUpdatedAt: c.updatedAt,
        host: 'other.example.test',
        imapUsername: 'other-inbox',
      }).expect(200)
    ).body;
    expect(c.hasPassword).toBe(false);
    expect(c.hasImapPassword).toBe(false);
    await call('put', 'email-config', { imapPort: 999999 }).expect(400);
    await call('put', 'email-config', { fromName: 'a\r\nb' }).expect(400);
    // Leave the isolated UI fixture safe, even if somebody later opens it locally.
    await call('put', 'email-config', { host: null, active: false, inboundActive: false }).expect(
      200,
    );
    await configure({ live: false });
  });
});
