import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

// Minimal fake dependencies — the gates fire before any other dependency is used.
function makeService(userOverrides: Record<string, unknown>) {
  const fakePrisma = {
    user: {
      findUniqueOrThrow: async () => ({
        id: 'u1',
        tenantId: 't1',
        email: 'test@corp.test',
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'ACTIVE' },
        ...userOverrides,
      }),
    },
  };
  const fakeJwt = {};
  const fakeConfig = {};
  const fakeAudit = {};
  const fakeEmail = {};

  return new AuthService(
    fakePrisma as never,
    fakeJwt as never,
    fakeConfig as never,
    fakeAudit as never,
    fakeEmail as never,
  );
}

describe('AuthService.issueSession — status gates', () => {
  it('throws UnauthorizedException when user status is DISABLED', async () => {
    const service = makeService({ status: 'DISABLED' });
    await expect(service.issueSession('u1')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user status is INVITED', async () => {
    const service = makeService({ status: 'INVITED' });
    await expect(service.issueSession('u1')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when tenant status is SUSPENDED', async () => {
    const service = makeService({
      status: 'ACTIVE',
      tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'SUSPENDED' },
    });
    await expect(service.issueSession('u1')).rejects.toThrow(UnauthorizedException);
  });
});
