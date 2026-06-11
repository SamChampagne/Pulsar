import type { PrismaClient } from '@pulsar/database';
import { Prisma } from '@pulsar/database';
import { decryptValue, encryptValue, isEncrypted } from './crypto.util';

/**
 * Re-encrypts every Integration.config with `newKey`.
 * - enc:v1 rows are decrypted with `oldKey` first (rotation);
 * - plaintext rows are simply encrypted (initial sweep after enabling at-rest encryption).
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
      try {
        plain = decryptValue(oldKey, row.config as unknown as string);
      } catch {
        // Already rotated by a previous interrupted run? Probe with the new key.
        try {
          decryptValue(newKey, row.config as unknown as string);
          continue; // row is fine under newKey — skip, the re-run stays idempotent
        } catch {
          throw new Error(
            `Integration ${row.id}: config decrypts with neither the old nor the new key`,
          );
        }
      }
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

/**
 * Re-encrypts Tenant.authConfig.clientSecret (rows without authConfig are skipped).
 * Idempotent: rows whose clientSecret already decrypts with `newKey` are skipped so
 * interrupted rotation runs can be safely retried.
 */
export async function reencryptAuthConfigs(
  prisma: PrismaClient,
  oldKey: Buffer | null,
  newKey: Buffer,
): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { authConfig: { not: Prisma.JsonNull } } });
  let updated = 0;
  for (const tenant of tenants) {
    const config = tenant.authConfig as { clientSecret?: string } & Record<string, unknown>;
    if (!config.clientSecret) continue;
    let plain: string;
    if (isEncrypted(config.clientSecret)) {
      if (!oldKey) {
        throw new Error(
          `Tenant ${tenant.id} authConfig is encrypted but ENCRYPTION_KEY_OLD is not set`,
        );
      }
      try {
        plain = decryptValue(oldKey, config.clientSecret);
      } catch {
        // Already rotated by a previous interrupted run? Probe with the new key.
        try {
          decryptValue(newKey, config.clientSecret);
          continue; // row is fine under newKey — skip, the re-run stays idempotent
        } catch {
          throw new Error(
            `Tenant ${tenant.id}: authConfig.clientSecret decrypts with neither the old nor the new key`,
          );
        }
      }
    } else {
      plain = config.clientSecret;
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { authConfig: { ...config, clientSecret: encryptValue(newKey, plain) } },
    });
    updated++;
  }
  return updated;
}
