import { decryptValue, encryptValue, isEncrypted, parseEncryptionKey } from './crypto.util';
import { reencryptAuthConfigs, reencryptIntegrations } from './reencrypt';

const OLD = parseEncryptionKey(Buffer.alloc(32, 1).toString('base64'));
const NEW = parseEncryptionKey(Buffer.alloc(32, 2).toString('base64'));

function fakePrisma(rows: { id: string; config: unknown }[]) {
  const updates: { id: string; config: string }[] = [];
  return {
    updates,
    integration: {
      findMany: async () => rows,
      update: async ({ where, data }: { where: { id: string }; data: { config: string } }) => {
        updates.push({ id: where.id, config: data.config });
      },
    },
  };
}

describe('reencryptIntegrations', () => {
  it('re-encrypts encrypted rows with the new key', async () => {
    const prisma = fakePrisma([{ id: 'a', config: encryptValue(OLD, '{"secret":"s"}') }]);
    const count = await reencryptIntegrations(prisma as never, OLD, NEW);
    expect(count).toBe(1);
    expect(decryptValue(NEW, prisma.updates[0].config)).toBe('{"secret":"s"}');
  });

  it('encrypts legacy plaintext rows (initial sweep)', async () => {
    const prisma = fakePrisma([{ id: 'b', config: { url: 'https://x' } }]);
    await reencryptIntegrations(prisma as never, null, NEW);
    expect(isEncrypted(prisma.updates[0].config)).toBe(true);
    expect(decryptValue(NEW, prisma.updates[0].config)).toBe('{"url":"https://x"}');
  });

  it('fails loudly when a row is encrypted but no old key is provided', async () => {
    const prisma = fakePrisma([{ id: 'c', config: encryptValue(OLD, '{}') }]);
    await expect(reencryptIntegrations(prisma as never, null, NEW)).rejects.toThrow(
      /ENCRYPTION_KEY_OLD/,
    );
  });

  it('is idempotent: rows already rotated to the new key are skipped on re-run', async () => {
    const prisma = fakePrisma([
      { id: 'd', config: encryptValue(NEW, '{"secret":"s"}') }, // already rotated
      { id: 'e', config: encryptValue(OLD, '{"secret":"t"}') }, // not yet
    ]);
    const count = await reencryptIntegrations(prisma as never, OLD, NEW);
    expect(count).toBe(1);
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0].id).toBe('e');
  });

  it('fails loudly when a row decrypts with neither key', async () => {
    const OTHER = parseEncryptionKey(Buffer.alloc(32, 3).toString('base64'));
    const prisma = fakePrisma([{ id: 'f', config: encryptValue(OTHER, '{}') }]);
    await expect(reencryptIntegrations(prisma as never, OLD, NEW)).rejects.toThrow(
      /neither the old nor the new key/,
    );
  });
});

describe('reencryptAuthConfigs', () => {
  it('re-encrypts the clientSecret inside authConfig', async () => {
    const stored = { enabled: true, issuer: 'https://idp', clientSecret: encryptValue(OLD, 'cs') };
    const updates: { id: string; authConfig: { clientSecret: string } }[] = [];
    const prisma = {
      tenant: {
        findMany: async () => [{ id: 't1', authConfig: stored }],
        update: async ({ where, data }: never) => {
          updates.push({ id: (where as { id: string }).id, ...(data as object) } as never);
        },
      },
    };
    const count = await reencryptAuthConfigs(prisma as never, OLD, NEW);
    expect(count).toBe(1);
    expect(decryptValue(NEW, updates[0].authConfig.clientSecret)).toBe('cs');
  });

  it('skips rows already rotated to the new key (idempotent)', async () => {
    const stored = { enabled: true, issuer: 'https://idp', clientSecret: encryptValue(NEW, 'cs') };
    const updates: unknown[] = [];
    const prisma = {
      tenant: {
        findMany: async () => [{ id: 't2', authConfig: stored }],
        update: async ({ where, data }: never) => {
          updates.push({ id: (where as { id: string }).id, ...(data as object) });
        },
      },
    };
    const count = await reencryptAuthConfigs(prisma as never, OLD, NEW);
    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
