import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortalUserRole } from '@pulsar/shared';
import { PortalJwtStrategy } from './portal-jwt.strategy';

const strategy = new PortalJwtStrategy({
  getOrThrow: () => 'test-secret',
} as unknown as ConfigService);

const validPayload = {
  sub: 'pu1',
  tenantId: 't1',
  customerId: 'c1',
  email: 'jane@acme-client.test',
  role: PortalUserRole.ADMIN,
  portal: true as const,
};

describe('PortalJwtStrategy', () => {
  it('accepts a portal payload and maps it to claims', () => {
    const claims = strategy.validate(validPayload);
    expect(claims).toEqual({
      id: 'pu1',
      tenantId: 't1',
      customerId: 'c1',
      email: 'jane@acme-client.test',
      role: PortalUserRole.ADMIN,
    });
  });

  it('rejects a tenant-plane payload (no portal claim)', () => {
    expect(() =>
      strategy.validate({ sub: 'u1', tenantId: 't1', email: 'a@b.c', permissions: [] } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a platform-plane payload', () => {
    expect(() =>
      strategy.validate({ sub: 'p1', email: 'platform@pulsar.dev', platformAdmin: true } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a truthy-but-not-true portal claim (string "true")', () => {
    expect(() => strategy.validate({ ...validPayload, portal: 'true' } as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a portal payload that also claims platform admin', () => {
    expect(() => strategy.validate({ ...validPayload, platformAdmin: true } as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a portal payload without tenantId', () => {
    expect(() => strategy.validate({ ...validPayload, tenantId: undefined } as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a portal payload without customerId (would widen the guard lookup)', () => {
    expect(() => strategy.validate({ ...validPayload, customerId: undefined } as never)).toThrow(
      UnauthorizedException,
    );
  });
});
