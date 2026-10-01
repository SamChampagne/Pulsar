import { PlatformServicesService } from './platform-services.service';
describe('Platform service routing', () => {
  const actor = { id: 'operator', email: 'operator@example.test' };
  function setup(status = 'ACTIVE') {
    const db = {
      tenant: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === 'known' ? { id: 'known', status } : null,
        ),
      },
      platformServiceAudit: { create: jest.fn() },
    };
    const config = {
      get: jest.fn(async () => ({ updatedAt: new Date('2026-10-01T00:00:00Z') })),
      upsert: jest.fn(async () => ({})),
      project: jest.fn((value) => value),
    };
    const email = {
      get: jest.fn(async () => null),
      upsert: jest.fn(),
      resolve: jest.fn(async () => null),
    };
    const smtp = { verify: jest.fn() };
    const health = { inspect: jest.fn() };
    const moduleRef = { get: jest.fn() };
    const svc = new PlatformServicesService(
      db as never,
      {} as never,
      smtp as never,
      email as never,
      config as never,
      health as never,
      moduleRef as never,
    );
    return { svc, config, email, smtp, health, moduleRef, db };
  }
  const dto = { confirmed: true, expectedUpdatedAt: null, provider: 'openrouter' };
  it('never probes a runner or exposes settings for a missing tenant', async () => {
    const { svc, health, config } = setup();
    await expect(svc.detail('missing')).rejects.toThrow('introuvable');
    expect(health.inspect).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalled();
  });
  it('suspended tenants cannot change connections or initiate a login', async () => {
    const { svc, config, db } = setup('SUSPENDED');
    await expect(svc.saveRuntime(actor, 'known', dto)).rejects.toThrow('Réactivez');
    await expect(svc.authorizeRuntimeAction(actor, 'known', dto, 'OAUTH_CONNECT')).rejects.toThrow(
      'Réactivez',
    );
    expect(config.upsert).not.toHaveBeenCalled();
    expect(db.platformServiceAudit.create).not.toHaveBeenCalled();
  });
  it('binds writes to the selected tenant, expected version and real platform actor', async () => {
    const { svc, config } = setup();
    await svc.saveRuntime(actor, 'known', dto);
    expect(config.upsert).toHaveBeenCalledWith(
      'known',
      expect.objectContaining({ provider: 'openrouter', authMode: 'apiKey' }),
      { actorId: 'operator', expectedUpdatedAt: null },
    );
  });
  it('never starts a runtime for a stale configuration', async () => {
    const { svc, moduleRef, db } = setup();
    await expect(svc.testRuntime(actor, 'known', dto)).rejects.toThrow('Rechargez');
    expect(moduleRef.get).not.toHaveBeenCalled();
    expect(db.platformServiceAudit.create).not.toHaveBeenCalled();
  });
  it('labels inherited transport honestly without sending or probing it as tenant SMTP', async () => {
    const { svc, smtp } = setup();
    const result = await svc.verifyEmail(actor, dto, 'known');
    expect(result.code).toBe('INHERITED');
    expect(smtp.verify).not.toHaveBeenCalled();
  });
  it('rejects an unsupported tenant kill switch instead of falling back to platform SMTP silently', async () => {
    const { svc, email } = setup();
    await expect(
      svc.saveEmail(actor, 'known', { ...dto, mode: 'SIMULATION', port: 587, secure: false }),
    ).rejects.toThrow('héritage');
    expect(email.upsert).not.toHaveBeenCalled();
  });
});
