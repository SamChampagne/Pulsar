import { RuntimeConfigService } from './runtime-config.service';

describe('RuntimeConfigService credential boundary', () => {
  const current = {
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    provider: 'custom',
    authMode: 'apiKey',
    baseUrl: 'https://one.test/v1',
    defaultModel: 'model',
    apiKeyEnc: 'encrypted-old',
    connectedAt: new Date(),
    lastTestOk: true,
  };
  function setup(row: object | null = current) {
    const tx = {
      platformServiceAudit: { create: jest.fn(async () => ({})) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      agentRuntimeConfig: {
        findUnique: jest.fn().mockResolvedValue(row),
        upsert: jest
          .fn()
          .mockImplementation(async ({ update, create }) => (row ? { ...row, ...update } : create)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { ...tx, $transaction: jest.fn(async (cb) => cb(tx)) };
    const crypto = { encryptString: jest.fn((v) => `encrypted:${v}`) };
    return { svc: new RuntimeConfigService(prisma as never, crypto as never), tx, crypto };
  }
  const input = {
    provider: 'custom',
    authMode: 'apiKey',
    baseUrl: 'https://one.test/v1',
    defaultModel: 'model',
  };
  it('preserves the credential only for the exact same identity', async () => {
    const { svc } = setup();
    expect((await svc.upsert('t1', input)).apiKeyEnc).toBe('encrypted-old');
  });
  it.each([
    { provider: 'openrouter', baseUrl: null },
    { baseUrl: 'https://two.test/v1' },
    { provider: 'openai-codex', authMode: 'login', baseUrl: null },
  ])('clears key, login and cached validation when identity changes: %p', async (change) => {
    const { svc, tx } = setup();
    const row = await svc.upsert('t1', { ...input, ...change });
    expect(row.apiKeyEnc).toBeNull();
    expect(row.connectedAt).toBeNull();
    expect(row.lastTestOk).toBeNull();
    expect(row.availableModels).toEqual([]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('encrypts an explicitly provided replacement for the new destination', async () => {
    const { svc } = setup();
    const row = await svc.upsert('t1', { ...input, baseUrl: 'https://two.test/v1', apiKey: 'new' });
    expect(row.apiKeyEnc).toBe('encrypted:new');
  });
  it('changing the model invalidates validation, but retains the same provider key', async () => {
    const { svc } = setup();
    const row = await svc.upsert('t1', { ...input, defaultModel: 'new-model' });
    expect(row.lastTestOk).toBeNull();
    expect(row.apiKeyEnc).toBe('encrypted-old');
  });
  it('a late test cannot validate a changed configuration', async () => {
    const { svc, tx } = setup();
    const date = new Date();
    tx.agentRuntimeConfig.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.markTested('t1', true, [], date)).rejects.toThrow('configuration a changé');
    expect(tx.agentRuntimeConfig.updateMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      updatedAt: date,
    });
  });
  it('rejects mismatched provider/authentication and credentials in a URL before persistence', async () => {
    const { svc, tx } = setup();
    await expect(svc.upsert('t1', { ...input, authMode: 'login' })).rejects.toThrow(
      'authentification',
    );
    await expect(
      svc.upsert('t1', { ...input, baseUrl: 'https://user:secret@example.test' }),
    ).rejects.toThrow('URL');
    expect(tx.agentRuntimeConfig.upsert).not.toHaveBeenCalled();
  });
  it('platform changes are versioned, tenant bound and audited without a key', async () => {
    const { svc, tx } = setup();
    await svc.upsert(
      't1',
      { ...input, apiKey: 'private-key' },
      { actorId: 'operator', expectedUpdatedAt: current.updatedAt.toISOString() },
    );
    expect(tx.platformServiceAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'operator',
          tenantId: 't1',
          service: 'tenant-ai',
        }),
      }),
    );
    expect(JSON.stringify(tx.platformServiceAudit.create.mock.calls)).not.toContain('private-key');
    const stale = setup();
    await expect(
      stale.svc.upsert('t1', input, { actorId: 'operator', expectedUpdatedAt: null }),
    ).rejects.toThrow('changé');
    expect(stale.tx.agentRuntimeConfig.upsert).not.toHaveBeenCalled();
  });
});
