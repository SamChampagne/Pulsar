import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../crypto/crypto.service';
import { packOidcState, unpackOidcState } from './oidc-state';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 3).toString('base64'),
} as unknown as ConfigService);

describe('oidc state', () => {
  it('round-trips verifier and nonce', () => {
    const state = packOidcState(crypto, { verifier: 'v', nonce: 'n', issuedAt: Date.now() });
    const unpacked = unpackOidcState(crypto, state);
    expect(unpacked.verifier).toBe('v');
    expect(unpacked.nonce).toBe('n');
  });

  it('rejects an expired state (10 min)', () => {
    const state = packOidcState(crypto, {
      verifier: 'v',
      nonce: 'n',
      issuedAt: Date.now() - 11 * 60_000,
    });
    expect(() => unpackOidcState(crypto, state)).toThrow(/expired/i);
  });

  it('rejects a tampered state', () => {
    expect(() => unpackOidcState(crypto, 'enc:v1:AAAA:BBBB:CCCC')).toThrow();
  });
});
