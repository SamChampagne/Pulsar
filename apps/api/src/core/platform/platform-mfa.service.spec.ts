import { authenticator } from 'otplib';
import { PlatformMfaService } from './platform-mfa.service';

describe('PlatformMfaService (pure parts)', () => {
  const service = new PlatformMfaService(null as never, null as never);

  it('verifyTotp accepts a current code and rejects garbage', () => {
    const secret = authenticator.generateSecret();
    expect(service.verifyTotp(secret, authenticator.generate(secret))).toBe(true);
    expect(service.verifyTotp(secret, '000000')).toBe(false);
  });

  it('generateRecoveryCodes returns 8 distinct 10-char codes', () => {
    const codes = service.generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{10}$/);
  });
});
