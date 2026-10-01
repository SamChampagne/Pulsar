import { reencryptPlatformEmail } from './reencrypt';
import { decryptValue, encryptValue } from './crypto.util';
describe('Platform SMTP key rotation', () => {
  const oldKey = Buffer.alloc(32, 2),
    newKey = Buffer.alloc(32, 3);
  it('rotates under a version/old-value check and is idempotent', async () => {
    let row = {
      id: 'smtp',
      updatedAt: new Date(),
      passwordEnc: encryptValue(oldKey, 'private-smtp'),
    };
    const prisma = {
      platformEmailConfig: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(async ({ where, data }) => {
          expect(where).toMatchObject({
            id: 'smtp',
            updatedAt: row.updatedAt,
            passwordEnc: row.passwordEnc,
          });
          row = { ...row, ...data };
          return { count: 1 };
        }),
      },
    };
    expect(await reencryptPlatformEmail(prisma as never, oldKey, newKey)).toBe(1);
    expect(decryptValue(newKey, row.passwordEnc)).toBe('private-smtp');
    expect(await reencryptPlatformEmail(prisma as never, oldKey, newKey)).toBe(0);
    expect(prisma.platformEmailConfig.updateMany).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a concurrent configuration and does not expose a secret in errors', async () => {
    const row = {
      id: 'smtp',
      updatedAt: new Date(),
      passwordEnc: encryptValue(oldKey, 'private-smtp'),
    };
    const prisma = {
      platformEmailConfig: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    await expect(reencryptPlatformEmail(prisma as never, null, newKey)).rejects.toThrow(
      'ENCRYPTION_KEY_OLD',
    );
    expect(prisma.platformEmailConfig.updateMany).not.toHaveBeenCalled();
    await expect(reencryptPlatformEmail(prisma as never, oldKey, newKey)).rejects.toThrow(
      'changed during rotation',
    );
  });
});
