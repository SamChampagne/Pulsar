import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptValue, encryptValue, isEncrypted, parseEncryptionKey } from './crypto.util';

/**
 * Secrets-at-rest encryption (AES-256-GCM, format enc:v1:...).
 * The key is validated in the constructor: the API refuses to boot without a
 * valid ENCRYPTION_KEY — same fail-fast posture as JWT_SECRET (getOrThrow).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'));
  }

  encryptString(plain: string): string {
    return encryptValue(this.key, plain);
  }

  decryptString(value: string): string {
    return decryptValue(this.key, value);
  }

  encryptJson(value: Record<string, unknown>): string {
    return encryptValue(this.key, JSON.stringify(value));
  }

  /** Accepts enc:v1 strings, legacy plain objects, or null/undefined. */
  decryptJson<T = Record<string, unknown>>(stored: unknown): T {
    if (isEncrypted(stored)) {
      return JSON.parse(decryptValue(this.key, stored)) as T;
    }
    return (stored ?? {}) as T;
  }
}
