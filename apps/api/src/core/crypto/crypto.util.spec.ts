import {
  decryptValue,
  encryptValue,
  isEncrypted,
  parseEncryptionKey,
} from './crypto.util';

const KEY = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));

describe('crypto.util', () => {
  it('round-trips a value', () => {
    const encrypted = encryptValue(KEY, '{"secret":"hunter2"}');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptValue(KEY, encrypted)).toBe('{"secret":"hunter2"}');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptValue(KEY, 'x')).not.toBe(encryptValue(KEY, 'x'));
  });

  it('passes plaintext through decrypt unchanged (legacy rows)', () => {
    expect(decryptValue(KEY, 'not-encrypted')).toBe('not-encrypted');
    expect(isEncrypted('not-encrypted')).toBe(false);
  });

  it('rejects a tampered ciphertext (GCM auth)', () => {
    const encrypted = encryptValue(KEY, 'payload');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decryptValue(KEY, tampered)).toThrow();
  });

  it('rejects a wrong key', () => {
    const other = parseEncryptionKey(Buffer.alloc(32, 9).toString('base64'));
    const encrypted = encryptValue(KEY, 'payload');
    expect(() => decryptValue(other, encrypted)).toThrow();
  });

  it('parseEncryptionKey rejects missing or short keys', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY/);
    expect(() => parseEncryptionKey('dG9vLXNob3J0')).toThrow(/32 bytes/);
  });
});
