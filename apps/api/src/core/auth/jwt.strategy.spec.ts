import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const strategy = new JwtStrategy({
  getOrThrow: () => 'test-secret',
} as unknown as ConfigService);

describe('JwtStrategy (tenant)', () => {
  it('accepts a regular tenant payload', () => {
    const user = strategy.validate({
      sub: 'u1',
      tenantId: 't1',
      email: 'a@b.c',
      permissions: [],
    });
    expect(user.tenantId).toBe('t1');
  });

  it('rejects platform tokens (platformAdmin claim)', () => {
    expect(() =>
      strategy.validate({
        sub: 'p1',
        email: 'platform@pulsar.dev',
        platformAdmin: true,
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects payloads without tenantId', () => {
    expect(() =>
      strategy.validate({ sub: 'u1', email: 'a@b.c', permissions: [] } as never),
    ).toThrow(UnauthorizedException);
  });
});
