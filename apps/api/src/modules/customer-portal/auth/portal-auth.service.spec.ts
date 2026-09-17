import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MODULE_KEYS, PortalUserRole, PortalUserStatus } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { EmailConfigService } from '../../../core/email/email-config.service';
import { EmailService } from '../../../core/email/email.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { PortalAuthService } from './portal-auth.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

interface FakePortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: PortalUserRole;
  status: PortalUserStatus;
  lastLoginAt: Date | null;
}

interface FakeActionToken {
  id: string;
  portalUserId: string;
  kind: 'INVITATION' | 'PASSWORD_RESET';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface FakeRefreshToken {
  id: string;
  portalUserId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const TENANT = {
  id: 't1',
  slug: 'acme',
  name: 'Acme Transport',
  status: 'ACTIVE',
  settings: { branding: { logoUrl: 'https://cdn.test/logo.png', accentColor: '#123456' } },
};
const CUSTOMER = { id: 'c1', name: 'Client Co', isActive: true };

/** Matches Prisma's equality / `{ not: … }` filter semantics used by this suite. */
function matches(actual: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter === null) return actual === null;
  if (typeof filter === 'object' && filter !== null && 'not' in (filter as object)) {
    const not = (filter as { not: unknown }).not;
    return not === null ? actual !== null : actual !== not;
  }
  return actual === filter;
}

function makeService(opts: {
  users?: FakePortalUser[];
  actionTokens?: FakeActionToken[];
  refreshTokens?: FakeRefreshToken[];
  tenant?: Partial<typeof TENANT>;
  customer?: Partial<typeof CUSTOMER>;
  enabledModules?: string[];
  /** Sentinel transport `EmailConfigService.resolve` should hand back, if any. */
  emailTransport?: Record<string, unknown> | null;
}) {
  const users = opts.users ?? [];
  const actionTokens = opts.actionTokens ?? [];
  const refreshTokens = opts.refreshTokens ?? [];
  const tenant = { ...TENANT, ...opts.tenant };
  const customer = { ...CUSTOMER, ...opts.customer };

  const hydrate = (u: FakePortalUser) => ({ ...u, tenant, customer });
  /**
   * The fake models a single tenant row (`tenant`); a `{ tenant: { slug } }`
   * filter therefore matches only accounts that belong to it — otherwise the
   * disambiguation-by-slug test would be meaningless.
   */
  const slugMatches = (u: FakePortalUser, where: any) =>
    where.tenant?.slug === undefined
      ? true
      : where.tenant.slug === tenant.slug && u.tenantId === tenant.id;

  const portalUser = {
    findMany: jest.fn(async ({ where }: any) => {
      return users
        .filter((u) => (where.email ? u.email === where.email : true))
        .filter((u) => slugMatches(u, where))
        .filter((u) => matches(u.status, where.status))
        .map(hydrate);
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const found = users
        .filter((u) => (where.email ? u.email === where.email : true))
        .filter((u) => (where.id ? u.id === where.id : true))
        .filter((u) => slugMatches(u, where))
        .find((u) => matches(u.status, where.status));
      return found ? hydrate(found) : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const found = users.find((u) => u.id === where.id);
      return found ? hydrate(found) : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const found = users.find((u) => u.id === where.id);
      if (found) Object.assign(found, data);
      return found;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = users
        .filter((u) => (where.id === undefined ? true : u.id === where.id))
        .filter((u) => matches(u.status, where.status));
      hits.forEach((u) => Object.assign(u, data));
      return { count: hits.length };
    }),
  };

  const portalActionToken = {
    findUnique: jest.fn(
      async ({ where }: any) => actionTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = actionTokens.filter(
        (t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.portalUserId === undefined || t.portalUserId === where.portalUserId) &&
          matches(t.usedAt, where.usedAt),
      );
      hits.forEach((t) => Object.assign(t, data));
      return { count: hits.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `at${actionTokens.length + 1}`, usedAt: null, ...data };
      actionTokens.push(row);
      return row;
    }),
  };

  const portalRefreshToken = {
    findUnique: jest.fn(
      async ({ where }: any) => refreshTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const found = refreshTokens.find((t) => t.id === where.id);
      if (found) Object.assign(found, data);
      return found;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = refreshTokens.filter(
        (t) =>
          (where.tokenHash === undefined || t.tokenHash === where.tokenHash) &&
          (where.portalUserId === undefined || t.portalUserId === where.portalUserId) &&
          matches(t.revokedAt, where.revokedAt),
      );
      hits.forEach((t) => Object.assign(t, data));
      return { count: hits.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `rt${refreshTokens.length + 1}`, revokedAt: null, ...data };
      refreshTokens.push(row);
      return row;
    }),
  };

  const prisma = {
    portalUser,
    portalActionToken,
    portalRefreshToken,
    // Interactive transactions run against the same fakes.
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  } as unknown as PrismaService;

  const jwt = {
    signAsync: jest.fn(async (payload: unknown) => `signed:${JSON.stringify(payload)}`),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'WEB_URL' ? 'https://app.test' : fallback,
    ),
  } as unknown as ConfigService;
  const email = { send: jest.fn(async () => true) } as unknown as EmailService;
  const emailConfig = {
    resolve: jest.fn(async () => opts.emailTransport ?? null),
  } as unknown as EmailConfigService;
  const modulesCache = {
    getEnabledKeys: jest.fn(
      async () => new Set(opts.enabledModules ?? [MODULE_KEYS.CUSTOMER_PORTAL]),
    ),
  } as unknown as TenantModulesCacheService;

  const service = new PortalAuthService(
    prisma,
    jwt as unknown as JwtService,
    config,
    email,
    emailConfig,
    modulesCache,
  );
  return {
    service,
    prisma,
    jwt,
    email,
    emailConfig,
    users,
    actionTokens,
    refreshTokens,
    portalUser,
  };
}

const PASSWORD = 'correct horse battery';
let PASSWORD_HASH: string;

function userFixture(over: Partial<FakePortalUser> = {}): FakePortalUser {
  return {
    id: 'pu1',
    tenantId: 't1',
    customerId: 'c1',
    email: 'jane@client.test',
    passwordHash: PASSWORD_HASH,
    firstName: 'Jane',
    lastName: 'Doe',
    role: PortalUserRole.ADMIN,
    status: PortalUserStatus.ACTIVE,
    lastLoginAt: null,
    ...over,
  };
}

beforeAll(async () => {
  PASSWORD_HASH = await hash(PASSWORD, 10);
});

describe('PortalAuthService.issuePortalSession', () => {
  it('signs a portal-claimed access token, stores only the refresh hash and exposes branding', async () => {
    const { service, jwt, refreshTokens } = makeService({ users: [userFixture()] });

    const session = await service.issuePortalSession('pu1');

    const payload = JSON.parse((session.accessToken as string).replace('signed:', ''));
    expect(payload).toEqual({
      sub: 'pu1',
      tenantId: 't1',
      customerId: 'c1',
      email: 'jane@client.test',
      role: PortalUserRole.ADMIN,
      portal: true,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '8h' });
    // The raw refresh token is returned once; only its sha256 is persisted.
    expect(refreshTokens).toHaveLength(1);
    expect(refreshTokens[0].tokenHash).toBe(sha256(session.refreshToken));
    expect(refreshTokens[0].tokenHash).not.toBe(session.refreshToken);
    expect(session.customer).toEqual({ id: 'c1', name: 'Client Co' });
    expect(session.shipper).toEqual({ name: 'Acme Transport' });
    expect(session.branding).toEqual({
      logoUrl: 'https://cdn.test/logo.png',
      accentColor: '#123456',
    });
    expect((session.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('refuses a DISABLED account', async () => {
    const { service } = makeService({
      users: [userFixture({ status: PortalUserStatus.DISABLED })],
    });
    await expect(service.issuePortalSession('pu1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an INVITED (not yet activated) account', async () => {
    const { service } = makeService({ users: [userFixture({ status: PortalUserStatus.INVITED })] });
    await expect(service.issuePortalSession('pu1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an inactive customer company', async () => {
    const { service } = makeService({ users: [userFixture()], customer: { isActive: false } });
    await expect(service.issuePortalSession('pu1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a SUSPENDED tenant', async () => {
    const { service } = makeService({ users: [userFixture()], tenant: { status: 'SUSPENDED' } });
    await expect(service.issuePortalSession('pu1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses when the customer-portal module is disabled (rule 15)', async () => {
    const { service } = makeService({ users: [userFixture()], enabledModules: ['transportation'] });
    await expect(service.issuePortalSession('pu1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an unknown account without leaking a Prisma error', async () => {
    const { service } = makeService({ users: [] });
    await expect(service.issuePortalSession('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tolerates a tenant without branding settings', async () => {
    const { service } = makeService({ users: [userFixture()], tenant: { settings: {} as never } });
    const session = await service.issuePortalSession('pu1');
    expect(session.branding).toEqual({ logoUrl: undefined, accentColor: undefined });
  });
});

describe('PortalAuthService.login', () => {
  it('logs in and stamps lastLoginAt', async () => {
    const { service, users } = makeService({ users: [userFixture()] });
    const session = await service.login({ email: 'Jane@Client.TEST', password: PASSWORD });
    expect(session.user.id).toBe('pu1');
    expect(users[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it('400s "tenant required" when the email exists in more than one tenant and no slug is given', async () => {
    const { service } = makeService({
      users: [userFixture(), userFixture({ id: 'pu2', tenantId: 't2' })],
    });
    await expect(service.login({ email: 'jane@client.test', password: PASSWORD })).rejects.toThrow(
      new BadRequestException('tenant required'),
    );
  });

  it('resolves the ambiguity when the tenant slug is supplied', async () => {
    const { service } = makeService({
      users: [userFixture(), userFixture({ id: 'pu2', tenantId: 't2' })],
    });
    await expect(
      service.login({ email: 'jane@client.test', password: PASSWORD, tenant: 'acme' }),
    ).resolves.toMatchObject({ user: { id: 'pu1' } });
  });

  it('401s with a generic message on a wrong password', async () => {
    const { service } = makeService({ users: [userFixture()] });
    await expect(service.login({ email: 'jane@client.test', password: 'nope' })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
  });

  it('401s with the same generic message on an unknown email (no enumeration)', async () => {
    const { service } = makeService({ users: [userFixture()] });
    await expect(service.login({ email: 'ghost@client.test', password: PASSWORD })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
  });

  it('401s with the same generic message on a DISABLED account', async () => {
    const { service } = makeService({
      users: [userFixture({ status: PortalUserStatus.DISABLED })],
    });
    await expect(service.login({ email: 'jane@client.test', password: PASSWORD })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
  });

  it('401s with the same generic message on an INVITED account', async () => {
    const { service } = makeService({ users: [userFixture({ status: PortalUserStatus.INVITED })] });
    await expect(service.login({ email: 'jane@client.test', password: PASSWORD })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
  });
});

describe('PortalAuthService.refresh / logout', () => {
  const liveToken = 'raw-refresh';
  const refreshFixture = (over: Partial<FakeRefreshToken> = {}): FakeRefreshToken => ({
    id: 'rt1',
    portalUserId: 'pu1',
    tokenHash: sha256(liveToken),
    expiresAt: new Date(Date.now() + 86400_000),
    revokedAt: null,
    ...over,
  });

  it('rotates: the presented token is revoked and a new pair is issued', async () => {
    const { service, refreshTokens } = makeService({
      users: [userFixture()],
      refreshTokens: [refreshFixture()],
    });
    const session = await service.refresh(liveToken);
    expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
    expect(refreshTokens).toHaveLength(2);
    expect(sha256(session.refreshToken)).toBe(refreshTokens[1].tokenHash);
  });

  it('401s on an unknown, revoked or expired refresh token', async () => {
    const { service } = makeService({
      users: [userFixture()],
      refreshTokens: [
        refreshFixture({ id: 'rt-revoked', tokenHash: sha256('revoked'), revokedAt: new Date() }),
        refreshFixture({
          id: 'rt-expired',
          tokenHash: sha256('expired'),
          expiresAt: new Date(Date.now() - 1000),
        }),
      ],
    });
    await expect(service.refresh('unknown')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh('revoked')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh('expired')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses to rotate a session whose account was disabled meanwhile', async () => {
    const { service } = makeService({
      users: [userFixture({ status: PortalUserStatus.DISABLED })],
      refreshTokens: [refreshFixture()],
    });
    await expect(service.refresh(liveToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout revokes the presented token and stays quiet about unknown ones', async () => {
    const { service, refreshTokens } = makeService({ refreshTokens: [refreshFixture()] });
    await expect(service.logout(liveToken)).resolves.toEqual({ loggedOut: true });
    expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
    await expect(service.logout('never-issued')).resolves.toEqual({ loggedOut: true });
  });
});

describe('PortalAuthService.requestPasswordReset', () => {
  it('always answers { ok: true } and emails a 1h link for a known ACTIVE account', async () => {
    const { service, email, actionTokens } = makeService({ users: [userFixture()] });
    await expect(service.requestPasswordReset('Jane@Client.test')).resolves.toEqual({ ok: true });
    expect(actionTokens).toHaveLength(1);
    expect(actionTokens[0].kind).toBe('PASSWORD_RESET');
    expect(actionTokens[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
    const [message] = (email.send as jest.Mock).mock.calls[0];
    expect(message.to).toBe('jane@client.test');
    expect(message.html).toContain('https://app.test/portal/reset/');
  });

  it("uses the tenant's SMTP transport when one is configured", async () => {
    const sentinelTransport = { host: 'smtp.tenant.test', port: 2525, secure: false };
    const { service, email, emailConfig } = makeService({
      users: [userFixture()],
      emailTransport: sentinelTransport,
    });
    await service.requestPasswordReset('jane@client.test');
    expect(emailConfig.resolve).toHaveBeenCalledWith('t1');
    const [, transport] = (email.send as jest.Mock).mock.calls[0];
    expect(transport).toBe(sentinelTransport);
  });

  it('falls back to the platform transport when the tenant has none configured', async () => {
    const { service, email } = makeService({ users: [userFixture()], emailTransport: null });
    await service.requestPasswordReset('jane@client.test');
    const [, transport] = (email.send as jest.Mock).mock.calls[0];
    expect(transport).toBeUndefined();
  });

  it('sends the link once, through the low-level channel only', async () => {
    const { service, email } = makeService({ users: [userFixture()] });
    await service.requestPasswordReset('jane@client.test');
    // The service is not wired to MailService at all: a live reset link is a
    // credential and must never land in the staff-readable outbox.
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('answers { ok: true } for an unknown email without writing a token or sending mail', async () => {
    const { service, email, actionTokens } = makeService({ users: [userFixture()] });
    await expect(service.requestPasswordReset('ghost@client.test')).resolves.toEqual({ ok: true });
    expect(actionTokens).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('answers { ok: true } for a DISABLED account without issuing a token', async () => {
    const { service, actionTokens } = makeService({
      users: [userFixture({ status: PortalUserStatus.DISABLED })],
    });
    await expect(service.requestPasswordReset('jane@client.test')).resolves.toEqual({ ok: true });
    expect(actionTokens).toHaveLength(0);
  });
});

describe('PortalAuthService.resetPassword', () => {
  const raw = 'raw-action-token';
  const tokenFixture = (over: Partial<FakeActionToken> = {}): FakeActionToken => ({
    id: 'at1',
    portalUserId: 'pu1',
    kind: 'PASSWORD_RESET',
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + 3600_000),
    usedAt: null,
    ...over,
  });

  it('consumes the token, sets the password, activates the account and revokes every refresh token', async () => {
    const { service, users, actionTokens, refreshTokens } = makeService({
      users: [userFixture({ status: PortalUserStatus.INVITED })],
      actionTokens: [tokenFixture({ kind: 'INVITATION' })],
      refreshTokens: [
        {
          id: 'rt1',
          portalUserId: 'pu1',
          tokenHash: sha256('old'),
          expiresAt: new Date(Date.now() + 86400_000),
          revokedAt: null,
        },
      ],
    });

    await expect(service.resetPassword(raw, 'a-new-password')).resolves.toEqual({ ok: true });

    expect(actionTokens[0].usedAt).toBeInstanceOf(Date);
    expect(users[0].status).toBe(PortalUserStatus.ACTIVE);
    expect(users[0].passwordHash).not.toBe(PASSWORD_HASH);
    expect(users[0].passwordHash).not.toContain('a-new-password');
    expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
  });

  it('401s when the token was already used (single-use)', async () => {
    const { service } = makeService({
      users: [userFixture()],
      actionTokens: [tokenFixture({ usedAt: new Date() })],
    });
    await expect(service.resetPassword(raw, 'a-new-password')).rejects.toThrow(
      new UnauthorizedException('Invalid or expired link'),
    );
  });

  it('401s on an expired or unknown token', async () => {
    const { service } = makeService({
      users: [userFixture()],
      actionTokens: [tokenFixture({ expiresAt: new Date(Date.now() - 1000) })],
    });
    await expect(service.resetPassword(raw, 'a-new-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.resetPassword('nope', 'a-new-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('400s when the account is disabled between the pre-check and the write (TOCTOU)', async () => {
    const { service, users, portalUser } = makeService({
      users: [userFixture()],
      actionTokens: [tokenFixture()],
    });
    // The pre-check sees an ACTIVE account; a concurrent deactivate lands right
    // after it. Only the conditional write can catch this.
    (portalUser.findUnique as jest.Mock).mockImplementationOnce(async () => {
      const snapshot = { ...users[0] };
      users[0].status = PortalUserStatus.DISABLED;
      return snapshot;
    });

    await expect(service.resetPassword(raw, 'a-new-password')).rejects.toThrow(
      new BadRequestException('Account is disabled'),
    );
    expect(users[0].status).toBe(PortalUserStatus.DISABLED);
    expect(users[0].passwordHash).toBe(PASSWORD_HASH);
  });

  it('400s when the token owner has been disabled (a live link must not resurrect it)', async () => {
    const { service, users, actionTokens } = makeService({
      users: [userFixture({ status: PortalUserStatus.DISABLED })],
      actionTokens: [tokenFixture()],
    });
    await expect(service.resetPassword(raw, 'a-new-password')).rejects.toThrow(
      new BadRequestException('Account is disabled'),
    );
    expect(users[0].status).toBe(PortalUserStatus.DISABLED);
    expect(actionTokens[0].usedAt).toBeNull();
  });
});
