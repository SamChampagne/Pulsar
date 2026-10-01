/**
 * Key rotation / initial encryption sweep.
 * Usage:
 *   ENCRYPTION_KEY=<new> [ENCRYPTION_KEY_OLD=<old>] pnpm --filter @pulsar/api reencrypt-secrets
 * Without ENCRYPTION_KEY_OLD, only plaintext rows are encrypted (initial sweep);
 * already-encrypted rows then cause a loud failure instead of silent corruption.
 */
import { PrismaClient } from '@pulsar/database';
import { parseEncryptionKey } from '../src/core/crypto/crypto.util';
import {
  reencryptAuthConfigs,
  reencryptIntegrations,
  reencryptPlatformEmail,
} from '../src/core/crypto/reencrypt';

async function main() {
  const newKey = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  const oldKey = process.env.ENCRYPTION_KEY_OLD
    ? parseEncryptionKey(process.env.ENCRYPTION_KEY_OLD, 'ENCRYPTION_KEY_OLD')
    : null;
  if (oldKey?.equals(newKey)) {
    throw new Error('ENCRYPTION_KEY_OLD equals ENCRYPTION_KEY — nothing to rotate.');
  }
  const prisma = new PrismaClient();
  try {
    const count = await reencryptIntegrations(prisma, oldKey, newKey);
    console.log(`Re-encrypted ${count} integration config(s).`);
    const authCount = await reencryptAuthConfigs(prisma, oldKey, newKey);
    console.log(`Re-encrypted ${authCount} tenant authConfig(s).`);
    console.log(
      `Re-encrypted ${await reencryptPlatformEmail(prisma, oldKey, newKey)} platform SMTP config(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[reencrypt-secrets] Fatal:', err);
  process.exit(1);
});
