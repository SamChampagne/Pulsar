import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { AuditAction, PortalUserRole, PortalUserStatus } from '@pulsar/shared';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { MailService } from '../../core/email/mail.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PortalUsersService } from './portal-users.service';

const TENANT = 't1';
const CUSTOMER = 'c1';

interface FakePortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PortalUserRole;
  status: PortalUserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  passwordHash: string;
  actionTokens?: Array<{ expiresAt: Date }>;
}

interface FakeActionToken {
  id: string;
  portalUserId: string;
  kind: 'INVITATION' | 'PASSWORD_RESET';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function matches(actual: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter === null) return actual === null;
  if (typeof filter === 'object' && filter !== null && 'not' in (filter as object)) {
    const not = (filter as { not: unknown }).not;
    return not === null ? actual !== null : actual !== not;
  }
  return actual === filter;
}

function user(over: Partial<FakePortalUser> = {}): FakePortalUser {
  return {
    id: 'pu1',
    tenantId: TENANT,
    customerId: CUSTOMER,
    email: 'jane@client.test',
    firstName: 'Jane',
    lastName: 'Doe',
    role: PortalUserRole.ADMIN,
    status: PortalUserStatus.ACTIVE,
    lastLoginAt: new Date('2026-01-01'),
    createdAt: new Date('2025-12-01'),
    passwordHash: 'hash-never-leaked',
    ...over,
  };
}

function makeService(opts: {
  users?: FakePortalUser[];
  actionTokens?: FakeActionToken[];
  tenantName?: string;
}) {
  const users = opts.users ?? [];
  const actionTokens = opts.actionTokens ?? [];
  const refreshRevocations: unknown[] = [];

  /**
   * Mirrors Prisma's `select`: only the requested top-level fields come back.
   * Without this the fake would hand `passwordHash` to the service and the
   * projection assertions would be testing the fake, not `portalUserSelect`.
   */
  const applySelect = (row: FakePortalUser, select: any) => {
    if (!select) return row;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (key === 'actionTokens') out.actionTokens = row.actionTokens ?? [];
      else out[key] = (row as unknown as Record<string, unknown>)[key];
    }
    return out as unknown as FakePortalUser;
  };

  const scoped = (where: any) =>
    users
      .filter((u) => (where.id === undefined ? true : u.id === where.id))
      .filter((u) => (where.tenantId === undefined ? true : u.tenantId === where.tenantId))
      .filter((u) => (where.customerId === undefined ? true : u.customerId === where.customerId))
      .filter((u) => matches(u.status, where.status))
      .filter((u) => (where.role === undefined ? true : u.role === where.role));

  const portalUser = {
    findMany: jest.fn(async ({ where, select }: any) =>
      scoped(where).map((u) => applySelect(u, select)),
    ),
    findFirst: jest.fn(async ({ where, select }: any) => {
      const found = scoped(where)[0];
      return found ? applySelect(found, select) : null;
    }),
    findUnique: jest.fn(async ({ where, select }: any) => {
      const found = where.tenantId_email
        ? users.find(
            (u) =>
              u.tenantId === where.tenantId_email.tenantId &&
              u.email === where.tenantId_email.email,
          )
        : users.find((u) => u.id === where.id);
      return found ? applySelect(found, select) : null;
    }),
    create: jest.fn(async ({ data, select }: any) => {
      const row: FakePortalUser = {
        ...user(),
        ...data,
        id: `new${users.length + 1}`,
        lastLoginAt: null,
        createdAt: new Date(),
        actionTokens: [],
      };
      users.push(row);
      return applySelect(row, select);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = scoped(where);
      hits.forEach((u) => Object.assign(u, data));
      return { count: hits.length };
    }),
    count: jest.fn(async ({ where }: any) => scoped(where).length),
  };

  const portalActionToken = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = actionTokens.filter(
        (t) =>
          (where.portalUserId === undefined || t.portalUserId === where.portalUserId) &&
          (where.kind === undefined || t.kind === where.kind) &&
          matches(t.usedAt, where.usedAt),
      );
      hits.forEach((t) => Object.assign(t, data));
      return { count: hits.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `at${actionTokens.length + 1}`, usedAt: null, ...data };
      actionTokens.push(row);
      const owner = users.find((u) => u.id === data.portalUserId);
      if (owner) owner.actionTokens = [{ expiresAt: data.expiresAt }];
      return row;
    }),
  };

  const portalRefreshToken = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      refreshRevocations.push({ where, data });
      return { count: 1 };
    }),
  };

  const tenantDelegate = {
    findUnique: jest.fn(async () => ({ name: opts.tenantName ?? 'Acme Transport' })),
  };

  const prisma = {
    portalUser,
    portalActionToken,
    portalRefreshToken,
    tenant: tenantDelegate,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  } as unknown as PrismaService;

  const ownership = { assertOwned: jest.fn(async () => undefined) } as unknown as OwnershipService;
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'WEB_URL' ? 'https://app.test' : fallback,
    ),
  } as unknown as ConfigService;
  const mail = { queue: jest.fn(async () => ({ id: 'em1' })) } as unknown as MailService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditLogsService;

  const service = new PortalUsersService(prisma, ownership, config, mail, audit);
  return {
    service,
    users,
    actionTokens,
    refreshRevocations,
    ownership,
    mail,
    audit,
    portalUser,
    portalActionToken,
  };
}

const STAFF = { kind: 'staff', userId: 'u-staff' } as const;

describe('PortalUsersService.listForCustomer', () => {
  it('projects without ever exposing the password hash and derives the invitation state', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const { service } = makeService({
      users: [
        user(),
        user({
          id: 'pu2',
          email: 'bob@client.test',
          role: PortalUserRole.MEMBER,
          status: PortalUserStatus.INVITED,
          actionTokens: [{ expiresAt }],
        }),
      ],
    });

    const list = await service.listForCustomer(TENANT, CUSTOMER);

    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty('passwordHash');
      expect(item).not.toHaveProperty('actionTokens');
    }
    expect(list[0].invitation).toBeNull();
    expect(list[1].invitation).toEqual({ expiresAt, expired: false });
  });

  it('scopes the query by tenantId AND customerId', async () => {
    const { service, portalUser } = makeService({ users: [] });
    await service.listForCustomer(TENANT, CUSTOMER);
    expect(portalUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, customerId: CUSTOMER } }),
    );
  });
});

describe('PortalUsersService.invite', () => {
  const dto = { email: 'New@Client.test', firstName: 'New', lastName: 'Person' };

  it('creates an INVITED account, issues a 72h invitation, emails it and audits the creation', async () => {
    const { service, users, actionTokens, mail, audit, ownership } = makeService({ users: [] });

    const result = await service.invite(TENANT, CUSTOMER, dto, STAFF);

    expect(ownership.assertOwned).toHaveBeenCalledWith('customer', CUSTOMER, TENANT);
    expect(users[0].email).toBe('new@client.test');
    expect(users[0].status).toBe(PortalUserStatus.INVITED);
    expect(users[0].role).toBe(PortalUserRole.MEMBER);
    // Unguessable placeholder — never the empty string, never the email.
    expect(users[0].passwordHash).toEqual(expect.any(String));
    expect(users[0].passwordHash.length).toBeGreaterThan(20);

    expect(actionTokens).toHaveLength(1);
    expect(actionTokens[0].kind).toBe('INVITATION');
    expect(actionTokens[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000);

    const [tenantId, message] = (mail.queue as jest.Mock).mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(message.toAddresses).toEqual(['new@client.test']);
    expect(message.subject).toContain('Acme Transport');
    expect(message.html).toContain('https://app.test/portal/activate/');

    expect(result.inviteUrl).toMatch(/^https:\/\/app\.test\/portal\/activate\//);
    expect(result).not.toHaveProperty('passwordHash');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: 'u-staff',
        action: AuditAction.CREATE,
        entityType: 'portal-user',
      }),
    );
  });

  it('honours an explicit ADMIN role', async () => {
    const { service, users } = makeService({ users: [] });
    await service.invite(TENANT, CUSTOMER, { ...dto, role: PortalUserRole.ADMIN }, STAFF);
    expect(users[0].role).toBe(PortalUserRole.ADMIN);
  });

  it('409s when the email already belongs to a portal account of the tenant', async () => {
    const { service } = makeService({ users: [user()] });
    await expect(
      service.invite(TENANT, CUSTOMER, { ...dto, email: 'JANE@client.test' }, STAFF),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when the unique index rejects the insert (race with the pre-check)', async () => {
    const { service, portalUser } = makeService({ users: [] });
    // The pre-check found nothing; a concurrent invite of the same address wins
    // the insert. Only the unique index catches this.
    (portalUser.create as jest.Mock).mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenantId', 'email'] },
      });
    });
    await expect(service.invite(TENANT, CUSTOMER, dto, STAFF)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('records a portal-plane inviter in the payload, never as AuditLog.userId', async () => {
    const { service, audit } = makeService({ users: [] });
    await service.invite(TENANT, CUSTOMER, dto, { kind: 'portal', portalUserId: 'pu9' });
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    // A PortalUser id is not a User id: it must never land in the FK column.
    expect(entry.userId).toBeUndefined();
    expect(entry.after.invitedByPortalUserId).toBe('pu9');
  });

  it('drops an api-key staff actor from AuditLog.userId (FK safety)', async () => {
    const { service, audit } = makeService({ users: [] });
    await service.invite(TENANT, CUSTOMER, dto, { kind: 'staff', userId: 'apikey:k1' });
    expect((audit.log as jest.Mock).mock.calls[0][0].userId).toBeUndefined();
  });
});

describe('PortalUsersService.deactivate', () => {
  it('400s when a portal admin tries to deactivate their own account', async () => {
    const { service, users } = makeService({ users: [user()] });
    await expect(
      service.deactivate(TENANT, CUSTOMER, 'pu1', { kind: 'portal', portalUserId: 'pu1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(users[0].status).toBe(PortalUserStatus.ACTIVE);
  });

  it('400s on the last ACTIVE ADMIN of the customer', async () => {
    const { service, users } = makeService({
      users: [user(), user({ id: 'pu2', role: PortalUserRole.MEMBER, email: 'bob@client.test' })],
    });
    await expect(service.deactivate(TENANT, CUSTOMER, 'pu1', STAFF)).rejects.toThrow(
      BadRequestException,
    );
    expect(users[0].status).toBe(PortalUserStatus.ACTIVE);
  });

  it('allows deactivating an ADMIN when another ACTIVE ADMIN remains', async () => {
    const { service, users } = makeService({
      users: [user(), user({ id: 'pu2', email: 'amy@client.test' })],
    });
    await service.deactivate(TENANT, CUSTOMER, 'pu1', STAFF);
    expect(users[0].status).toBe(PortalUserStatus.DISABLED);
  });

  it('disables a MEMBER, invalidates open tokens, revokes refresh tokens and audits the change', async () => {
    const { service, users, actionTokens, refreshRevocations, audit } = makeService({
      users: [user(), user({ id: 'pu2', email: 'bob@client.test', role: PortalUserRole.MEMBER })],
      actionTokens: [
        {
          id: 'at1',
          portalUserId: 'pu2',
          kind: 'INVITATION',
          tokenHash: 'h',
          expiresAt: new Date(Date.now() + 1000),
          usedAt: null,
        },
      ],
    });

    await service.deactivate(TENANT, CUSTOMER, 'pu2', STAFF);

    expect(users[1].status).toBe(PortalUserStatus.DISABLED);
    expect(actionTokens[0].usedAt).toBeInstanceOf(Date);
    expect(refreshRevocations).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.STATUS_CHANGE,
        entityType: 'portal-user',
        entityId: 'pu2',
        before: { status: PortalUserStatus.ACTIVE },
        after: { status: PortalUserStatus.DISABLED },
      }),
    );
  });

  it('404s on an account of another customer of the same tenant (scoping)', async () => {
    const { service } = makeService({
      users: [user({ id: 'pu9', customerId: 'c-other', role: PortalUserRole.MEMBER })],
    });
    await expect(service.deactivate(TENANT, CUSTOMER, 'pu9', STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent on an already DISABLED account (no second audit entry)', async () => {
    const { service, audit } = makeService({
      users: [user({ id: 'pu2', role: PortalUserRole.MEMBER, status: PortalUserStatus.DISABLED })],
    });
    await service.deactivate(TENANT, CUSTOMER, 'pu2', STAFF);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('PortalUsersService.reactivate', () => {
  it('returns a never-logged-in account to INVITED with a fresh invitation link', async () => {
    const { service, users, actionTokens } = makeService({
      users: [
        user({
          id: 'pu2',
          role: PortalUserRole.MEMBER,
          status: PortalUserStatus.DISABLED,
          lastLoginAt: null,
        }),
      ],
    });

    const result = await service.reactivate(TENANT, CUSTOMER, 'pu2', STAFF);

    expect(users[0].status).toBe(PortalUserStatus.INVITED);
    expect(actionTokens).toHaveLength(1);
    expect((result as { inviteUrl?: string }).inviteUrl).toMatch(
      /^https:\/\/app\.test\/portal\/activate\//,
    );
  });

  it('returns an account that already logged in straight to ACTIVE, with no new invitation', async () => {
    const { service, users, actionTokens } = makeService({
      users: [user({ status: PortalUserStatus.DISABLED, lastLoginAt: new Date('2026-02-02') })],
    });

    const result = await service.reactivate(TENANT, CUSTOMER, 'pu1', STAFF);

    expect(users[0].status).toBe(PortalUserStatus.ACTIVE);
    expect(actionTokens).toHaveLength(0);
    expect(result).not.toHaveProperty('inviteUrl');
  });

  it('400s when the account is not disabled', async () => {
    const { service } = makeService({ users: [user()] });
    await expect(service.reactivate(TENANT, CUSTOMER, 'pu1', STAFF)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PortalUsersService.resendInvitation', () => {
  it('invalidates the previous invitation and issues a new one', async () => {
    const { service, actionTokens } = makeService({
      users: [user({ status: PortalUserStatus.INVITED })],
      actionTokens: [
        {
          id: 'at1',
          portalUserId: 'pu1',
          kind: 'INVITATION',
          tokenHash: 'old',
          expiresAt: new Date(Date.now() + 1000),
          usedAt: null,
        },
      ],
    });

    const result = await service.resendInvitation(TENANT, CUSTOMER, 'pu1', STAFF);

    expect(actionTokens[0].usedAt).toBeInstanceOf(Date);
    expect(actionTokens).toHaveLength(2);
    expect(result.inviteUrl).toMatch(/^https:\/\/app\.test\/portal\/activate\//);
  });

  it('400s when the account is not pending invitation', async () => {
    const { service } = makeService({ users: [user()] });
    await expect(service.resendInvitation(TENANT, CUSTOMER, 'pu1', STAFF)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s on an account of another customer (scoping)', async () => {
    const { service } = makeService({
      users: [user({ id: 'pu9', customerId: 'c-other', status: PortalUserStatus.INVITED })],
    });
    await expect(service.resendInvitation(TENANT, CUSTOMER, 'pu9', STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
