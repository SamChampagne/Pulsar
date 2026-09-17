import { BadRequestException, UnauthorizedException } from '@nestjs/common';
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

// Fresh, unused, unexpired token record — the shape resetPassword expects
// past its initial validity gate.
function liveTokenRecord() {
  return {
    id: 'tok1',
    userId: 'u1',
    usedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
  };
}

function makeResetPasswordService(opts: { tokenRecord: unknown; userStatus: string | null }) {
  const fakePrisma = {
    userActionToken: {
      findUnique: async () => opts.tokenRecord,
      update: async (_args: unknown) => ({}),
    },
    user: {
      findUnique: async () => (opts.userStatus === null ? null : { status: opts.userStatus }),
      update: async (_args: unknown) => ({}),
    },
    refreshToken: {
      updateMany: async (_args: unknown) => ({ count: 0 }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
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

describe('AuthService.resetPassword — finding 1(b): disabled accounts', () => {
  it('rejects with BadRequestException before writing anything when the token owner is DISABLED', async () => {
    const service = makeResetPasswordService({ tokenRecord: liveTokenRecord(), userStatus: 'DISABLED' });
    await expect(service.resetPassword('sometoken', 'new-Passw0rd!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still succeeds for a live token whose user is not disabled', async () => {
    const service = makeResetPasswordService({ tokenRecord: liveTokenRecord(), userStatus: 'INVITED' });
    await expect(service.resetPassword('sometoken', 'new-Passw0rd!')).resolves.toEqual({ ok: true });
  });
});
