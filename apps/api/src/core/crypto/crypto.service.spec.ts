import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const configWith = (key: string | undefined) =>
  ({ get: () => key }) as unknown as ConfigService;

const VALID_KEY = Buffer.alloc(32, 5).toString('base64');

describe('CryptoService', () => {
  it('refuses to construct without a valid key (API must not boot)', () => {
    expect(() => new CryptoService(configWith(undefined))).toThrow(/ENCRYPTION_KEY/);
    expect(() => new CryptoService(configWith('bm90LTMyLWJ5dGVz'))).toThrow(/32 bytes/);
  });

  it('round-trips JSON configs', () => {
    const service = new CryptoService(configWith(VALID_KEY));
    const stored = service.encryptJson({ url: 'https://x', secret: 's3cret' });
    expect(typeof stored).toBe('string');
    expect(service.decryptJson(stored)).toEqual({ url: 'https://x', secret: 's3cret' });
  });

  it('decryptJson passes legacy plain objects through', () => {
    const service = new CryptoService(configWith(VALID_KEY));
    expect(service.decryptJson({ url: 'https://x' })).toEqual({ url: 'https://x' });
    expect(service.decryptJson(null)).toEqual({});
  });
});
