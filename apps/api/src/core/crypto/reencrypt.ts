import type { PrismaClient } from '@pulsar/database';
import { decryptValue, encryptValue, isEncrypted } from './crypto.util';

/**
 * Re-encrypts every Integration.config with `newKey`.
 * - enc:v1 rows are decrypted with `oldKey` first (rotation);
 * - plaintext rows are simply encrypted (initial sweep after enabling at-rest encryption).
 * NOTE(plan 6C): when Tenant.authConfig lands (OIDC), add a reencryptAuthConfigs()
 * sibling here and call it from scripts/reencrypt-secrets.ts.
 */
export async function reencryptIntegrations(
  prisma: PrismaClient,
  oldKey: Buffer | null,
  newKey: Buffer,
): Promise<number> {
  const rows = await prisma.integration.findMany();
  let updated = 0;
  for (const row of rows) {
    let plain: string;
    if (isEncrypted(row.config)) {
      if (!oldKey) {
        throw new Error(
          `Integration ${row.id} is encrypted but ENCRYPTION_KEY_OLD is not set`,
        );
      }
      plain = decryptValue(oldKey, row.config as unknown as string);
    } else {
      plain = JSON.stringify(row.config ?? {});
    }
    await prisma.integration.update({
      where: { id: row.id },
      data: { config: encryptValue(newKey, plain) },
    });
    updated++;
  }
  return updated;
}
