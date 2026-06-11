/**
 * Key rotation / initial encryption sweep.
 * Usage:
 *   ENCRYPTION_KEY=<new> [ENCRYPTION_KEY_OLD=<old>] pnpm --filter @pulsar/api reencrypt-secrets
 * Without ENCRYPTION_KEY_OLD, only plaintext rows are encrypted (initial sweep);
 * already-encrypted rows then cause a loud failure instead of silent corruption.
 */
import { PrismaClient } from '@pulsar/database';
import { parseEncryptionKey } from '../src/core/crypto/crypto.util';
import { reencryptIntegrations } from '../src/core/crypto/reencrypt';

async function main() {
  const newKey = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  const oldKey = process.env.ENCRYPTION_KEY_OLD
    ? parseEncryptionKey(process.env.ENCRYPTION_KEY_OLD)
    : null;
  const prisma = new PrismaClient();
  try {
    const count = await reencryptIntegrations(prisma, oldKey, newKey);
    console.log(`Re-encrypted ${count} integration config(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
