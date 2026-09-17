import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformJwtStrategy } from './platform-jwt.strategy';

const strategy = new PlatformJwtStrategy({
  getOrThrow: () => 'test-secret',
} as unknown as ConfigService);

describe('PlatformJwtStrategy', () => {
  it('accepts a platform payload', () => {
    expect(
      strategy.validate({ sub: 'p1', email: 'platform@pulsar.dev', platformAdmin: true }),
    ).toEqual({ id: 'p1', email: 'platform@pulsar.dev' });
  });

  it('rejects step tokens (scope claim)', () => {
    expect(() =>
      strategy.validate({
        sub: 'p1',
        email: 'platform@pulsar.dev',
        platformAdmin: true,
        scope: 'mfa-pending',
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects tenant tokens', () => {
    expect(() =>
      strategy.validate({ sub: 'u1', tenantId: 't1', email: 'a@b.c', permissions: [] } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects portal tokens', () => {
    expect(() =>
      strategy.validate({
        sub: 'pu1',
        tenantId: 't1',
        customerId: 'c1',
        email: 'jane@acme-client.test',
        role: 'ADMIN',
        portal: true,
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a portal token that also claims platform admin', () => {
    expect(() =>
      strategy.validate({
        sub: 'pu1',
        email: 'jane@acme-client.test',
        portal: true,
        platformAdmin: true,
      } as never),
    ).toThrow(UnauthorizedException);
  });
});
