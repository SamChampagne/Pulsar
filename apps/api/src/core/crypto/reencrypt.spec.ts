import { decryptValue, encryptValue, isEncrypted, parseEncryptionKey } from './crypto.util';
import { reencryptIntegrations } from './reencrypt';

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
});
