import { UnauthorizedException } from '@nestjs/common';
import { OidcService } from './oidc.service';

type AnyRecord = Record<string, unknown>;

function fakePrisma(users: AnyRecord[]) {
  const created: AnyRecord[] = [];
  const updated: AnyRecord[] = [];
  return {
    created,
    updated,
    user: {
      findFirst: async ({ where }: { where: AnyRecord }) => {
        if (where.oidcSubject) {
          return users.find((u) => u.oidcSubject === where.oidcSubject) ?? null;
        }
        return users.find((u) => u.email === where.email) ?? null;
      },
      update: async ({ where, data }: { where: AnyRecord; data: AnyRecord }) => {
        updated.push({ ...where, ...data });
        return { ...users[0], ...data };
      },
      create: async ({ data }: { data: AnyRecord }) => {
        const user = { id: 'new-user', ...data };
        created.push(user);
        return user;
      },
    },
  };
}

const service = Object.create(OidcService.prototype) as OidcService;

describe('OidcService.lookupOrProvision', () => {
  const claims = { sub: 'idp-sub-1', email: 'jane@corp.test', given_name: 'Jane' };

  it('matches by oidcSubject first', async () => {
    const prisma = fakePrisma([
      { id: 'u1', email: 'old@corp.test', oidcSubject: 'idp-sub-1', status: 'ACTIVE' },
    ]);
    const { user, provisioned } = await service.lookupOrProvision(
      prisma as never,
      't1',
      claims,
      'role1',
    );
    expect(user.id).toBe('u1');
    expect(provisioned).toBe(false);
    expect(prisma.created).toHaveLength(0);
  });

  it('falls back to email and binds the subject', async () => {
    const prisma = fakePrisma([
      { id: 'u2', email: 'jane@corp.test', oidcSubject: null, status: 'ACTIVE' },
    ]);
    const { provisioned } = await service.lookupOrProvision(prisma as never, 't1', claims, 'role1');
    expect(provisioned).toBe(false);
    expect(prisma.updated[0]).toMatchObject({ id: 'u2', oidcSubject: 'idp-sub-1' });
  });

  it('provisions a new ACTIVE user with the default role', async () => {
    const prisma = fakePrisma([]);
    const { user, provisioned } = await service.lookupOrProvision(
      prisma as never,
      't1',
      claims,
      'role1',
    );
    expect(user.id).toBe('new-user');
    expect(provisioned).toBe(true);
    expect(prisma.created[0]).toMatchObject({
      tenantId: 't1',
      email: 'jane@corp.test',
      oidcSubject: 'idp-sub-1',
      status: 'ACTIVE',
    });
  });

  it('refuses a DISABLED user', async () => {
    const prisma = fakePrisma([
      { id: 'u3', email: 'jane@corp.test', oidcSubject: 'idp-sub-1', status: 'DISABLED' },
    ]);
    await expect(
      service.lookupOrProvision(prisma as never, 't1', claims, 'role1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('provisions a new user when email_verified is false (never binds to existing account)', async () => {
    // An existing account has this email but no oidcSubject.
    // The IdP says email_verified: false — we must NOT bind to the existing account
    // (account-takeover hardening). Instead provision a fresh user.
    const prisma = fakePrisma([
      { id: 'u-existing', email: 'jane@corp.test', oidcSubject: null, status: 'ACTIVE' },
    ]);
    const unverifiedClaims = { sub: 'idp-sub-unverified', email: 'jane@corp.test', email_verified: false };
    const { user, provisioned } = await service.lookupOrProvision(
      prisma as never,
      't1',
      unverifiedClaims,
      'role1',
    );
    expect(provisioned).toBe(true);
    expect(user.id).toBe('new-user');
    // The existing account must NOT have been updated (no binding).
    expect(prisma.updated).toHaveLength(0);
  });
});
