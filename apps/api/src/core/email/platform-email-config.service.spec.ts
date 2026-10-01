import { PlatformEmailConfigService } from './platform-email-config.service';
import { EmailService } from './email.service';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('Platform service center SMTP — no provider', () => {
  const actor = { id: 'operator', email: 'operator@example.test' };
  const dto = {
    mode: 'SMTP' as const,
    host: 'smtp.example.test',
    username: 'sender',
    password: 'secret',
    fromEmail: 'sender@example.test',
    port: 587,
    secure: false,
    expectedUpdatedAt: null,
    confirmed: true,
  };
  function setup(initial: any = null) {
    let row = initial;
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      platformEmailConfig: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create, update }) => (row = row ? { ...row, ...update } : create)),
      },
      platformServiceAudit: { create: jest.fn(async (args) => ({ id: 'audit', ...args.data })) },
    };
    const db = { ...tx, $transaction: jest.fn(async (cb) => cb(tx)) };
    const crypto = {
      encryptString: jest.fn((v) => `enc:${v}`),
      decryptString: jest.fn((v) => v.slice(4)),
    };
    const svc = new PlatformEmailConfigService(db as never, crypto as never);
    return { svc, tx, crypto };
  }
  beforeEach(() => jest.clearAllMocks());
  it('preserves environment on absent row, encrypts an explicit override and never projects its secret', async () => {
    const { svc, tx } = setup();
    expect(await svc.resolve()).toBeUndefined();
    const result = await svc.save(actor, dto);
    expect(result).toMatchObject({ mode: 'SMTP', hasPassword: true });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(tx.platformServiceAudit.create.mock.calls)).not.toContain('secret');
    expect(tx.platformServiceAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: 'operator' }) }),
    );
    expect(await svc.resolve()).toMatchObject({ pass: 'secret', requireTLS: true });
  });
  it('rejects stale edits and missing explicit confirmation before writing', async () => {
    const { svc, tx } = setup({ updatedAt: new Date() });
    await expect(svc.save(actor, dto)).rejects.toThrow('changé');
    await expect(svc.save(actor, { ...dto, confirmed: false })).rejects.toThrow('Confirmez');
    expect(tx.platformEmailConfig.upsert).not.toHaveBeenCalled();
  });
  it('never forwards an old password to a changed SMTP account', async () => {
    const { svc } = setup();
    const first = await svc.save(actor, dto);
    await expect(
      svc.save(actor, {
        ...dto,
        expectedUpdatedAt: first.updatedAt,
        username: 'other',
        password: undefined,
      }),
    ).rejects.toThrow('secret');
    await svc.save(actor, {
      ...dto,
      expectedUpdatedAt: first.updatedAt,
      username: 'other',
      password: undefined,
      mode: 'SIMULATION',
    });
    expect((await svc.get()).hasPassword).toBe(false);
    expect(await svc.resolve()).toBeNull();
  });
  it('preserves a password only for the unchanged host and account', async () => {
    const { svc } = setup();
    const first = await svc.save(actor, dto);
    await svc.save(actor, { ...dto, expectedUpdatedAt: first.updatedAt, password: undefined });
    expect(await svc.resolve()).toMatchObject({ pass: 'secret' });
  });
  it('verifies TLS/auth only and closes its client; provider errors are not exposed', async () => {
    const { svc, tx } = setup();
    const verify = jest.fn().mockRejectedValue(new Error('AUTH secret credential')),
      close = jest.fn(),
      sendMail = jest.fn();
    (createTransport as jest.Mock).mockReturnValue({ verify, close, sendMail });
    const result = await svc.verify(actor, { host: dto.host, port: 587, secure: false });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(sendMail).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(tx.platformServiceAudit.create).toHaveBeenCalledTimes(2);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: true, connectionTimeout: 10000 }),
    );
  });
  it('does not touch SMTP during a simulation check', async () => {
    const { svc } = setup();
    expect((await svc.verify(actor, null)).code).toBe('SIMULATION');
    expect(createTransport).not.toHaveBeenCalled();
  });
  it('a platform override works without restart; forced simulation and tenant overrides stay distinct', async () => {
    const resolve = jest
      .fn<any, []>()
      .mockResolvedValue({ host: dto.host, port: 587, secure: false, from: dto.fromEmail });
    const service = new EmailService(new ConfigService({ EMAIL_DRIVER: 'log' }), {
      resolve,
    } as never);
    const sendMail = jest.fn(async () => ({})),
      close = jest.fn();
    (createTransport as jest.Mock).mockReturnValue({ sendMail, close });
    const message = { to: 'test@example.test', subject: 'Test', html: '<p>Test</p>' };
    expect(await service.effectiveChannel()).toBe('smtp');
    await service.send(message);
    expect(sendMail).toHaveBeenCalledTimes(1);
    await service.send(message, null);
    expect(sendMail).toHaveBeenCalledTimes(1);
    resolve.mockResolvedValue(null);
    expect(await service.effectiveChannel()).toBe('log');
    await service.send(message, { host: 'tenant.test', port: 465, secure: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
  it('configuration failure never silently falls back to environment SMTP', async () => {
    const service = new EmailService(
      new ConfigService({ EMAIL_DRIVER: 'smtp', SMTP_HOST: 'env.test' }),
      {
        resolve: async () => {
          throw new Error('db unavailable');
        },
      } as never,
    );
    expect(await service.send({ to: 'test@example.test', subject: '', html: '' })).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
