import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Encrypted-at-rest format: enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64> */
const PREFIX = 'enc:v1:';

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is required (32 bytes, base64). Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256-GCM).');
  }
  return key;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptValue(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Values without the enc:v1: prefix are legacy plaintext and pass through unchanged. */
export function decryptValue(key: Buffer, value: string): string {
  if (!isEncrypted(value)) return value;
  const [iv, tag, ciphertext] = value.slice(PREFIX.length).split(':');
  if (!iv || !tag || !ciphertext) {
    throw new Error('malformed enc:v1 value (expected iv:tag:ciphertext)');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
