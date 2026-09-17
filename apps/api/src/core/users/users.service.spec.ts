import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MailService } from '../email/mail.service';
import { UsersService } from './users.service';

const TENANT = 'ten1';
const ADMIN_ROLE = { id: 'role-admin', isSystem: true, key: 'admin' };
const OTHER_ROLE = { id: 'role-viewer', isSystem: false, key: 'viewer' };

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  lastLoginAt: Date | null;
  roles: Array<{ role: { id: string; isSystem: boolean; key: string } }>;
  actionTokens?: Array<{ expiresAt: Date }>;
}

/** Mirrors Prisma's `updateMany` filter semantics needed by this test file: a
 * plain-value `status` filter (equality) and a `{ not }` filter (inequality). */
function statusMatches(actual: string, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return actual === filter;
  if (typeof filter === 'object' && filter !== null && 'not' in filter) {
    return actual !== (filter as { not: string }).not;
  }
  return true;
}

function fakePrisma(opts: { users: FakeUser[]; activeAdminCount?: number }) {
  const users = opts.users;
  const updateMany = jest.fn(async ({ where, data }: any) => {
    const match = users.find(
      (u) => u.id === where.id && u.tenantId === where.tenantId && statusMatches(u.status, where.status),
    );
    if (!match) return { count: 0 };
    Object.assign(match, data);
    return { count: 1 };
  });
  const update = jest.fn(async ({ where, data }: any) => {
    const match = users.find((u) => u.id === where.id);
    if (match) Object.assign(match, data);
    return { ...match, actionTokens: match?.actionTokens ?? [] };
  });
  const findFirst = jest.fn(async ({ where }: any) => {
    return (
      users.find((u) => u.id === where.id && (where.tenantId ? u.tenantId === where.tenantId : true)) ?? null
    );
  });
  const findUnique = jest.fn(async ({ where }: any) => {
    if (where.tenantId_email) {
      const { tenantId, email } = where.tenantId_email;
      return users.find((u) => u.tenantId === tenantId && u.email === email) ?? null;
    }
    if (where.id) return users.find((u) => u.id === where.id) ?? null;
    return null;
  });
  const create = jest.fn(async ({ data }: any) => {
    const newUser: FakeUser = {
      id: `new-${users.length + 1}`,
      tenantId: data.tenantId,
      email: data.email,
      status: data.status,
      lastLoginAt: null,
      roles: [],
    };
    users.push(newUser);
    return { ...newUser, actionTokens: [] };
  });
  const count = jest.fn(async () => opts.activeAdminCount ?? 0);
  const userActionTokenUpdateMany = jest.fn(async () => ({ count: 1 }));
  // Simulates the `actionTokens` relation well enough for project(): the most
  // recently created (unused) token becomes the owning user's visible one.
  const userActionTokenCreate = jest.fn(async ({ data }: any) => {
    const owner = users.find((u) => u.id === data.userId);
    if (owner) owner.actionTokens = [{ expiresAt: data.expiresAt }];
    return { id: 'token1', ...data };
  });

  const prisma = {
    user: { findFirst, findUnique, create, update, updateMany, count },
    userActionToken: { updateMany: userActionTokenUpdateMany, create: userActionTokenCreate },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    }),
  } as unknown as PrismaService;
  return prisma;
}

const ownership = { assertOwned: jest.fn(async () => undefined) } as unknown as OwnershipService;
const config = { get: jest.fn(() => 'http://web') } as unknown as ConfigService;
const mail = { queue: jest.fn(async () => undefined) } as unknown as MailService;
const audit = { log: jest.fn(async () => undefined) } as unknown as AuditLogsService;

async function build(prisma: PrismaService) {
  const m = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: PrismaService, useValue: prisma },
      { provide: OwnershipService, useValue: ownership },
      { provide: ConfigService, useValue: config },
      { provide: MailService, useValue: mail },
      { provide: AuditLogsService, useValue: audit },
    ],
  }).compile();
  return m.get(UsersService);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UsersService.deactivate', () => {
  it('rejects deactivating your own account', async () => {
    const me: FakeUser = {
      id: 'u1',
      tenantId: TENANT,
      email: 'me@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [],
    };
    const svc = await build(fakePrisma({ users: [me] }));
    await expect(svc.deactivate(TENANT, 'u1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects deactivating the last active admin, checking tenantId/status/role in the count', async () => {
    const target: FakeUser = {
      id: 'u2',
      tenantId: TENANT,
      email: 'admin@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const prisma = fakePrisma({ users: [target], activeAdminCount: 1 });
    const svc = await build(prisma);
    await expect(svc.deactivate(TENANT, 'u2', 'actor1')).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).user.count).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        status: 'ACTIVE',
        roles: { some: { role: { isSystem: true, key: 'admin' } } },
      },
    });
    expect((prisma as any).user.updateMany).not.toHaveBeenCalled();
  });

  it('deactivates when another active admin remains, invalidates open tokens and audits the change', async () => {
    const target: FakeUser = {
      id: 'u3',
      tenantId: TENANT,
      email: 'admin2@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const prisma = fakePrisma({ users: [target], activeAdminCount: 2 });
    const svc = await build(prisma);
    const result = await svc.deactivate(TENANT, 'u3', 'actor1');

    expect(result.status).toBe('DISABLED');
    expect((prisma as any).user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u3', tenantId: TENANT, status: { not: 'DISABLED' } },
      data: { status: 'DISABLED' },
    });
    // Finding 1(a): a live token must not survive deactivation (any kind, not just INVITATION).
    expect((prisma as any).userActionToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u3', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: 'actor1',
        action: 'STATUS_CHANGE',
        entityType: 'user',
        entityId: 'u3',
        before: { status: 'ACTIVE' },
        after: { status: 'DISABLED' },
      }),
    );
    // Finding 7: the id-lookup select must not pull passwordHash.
    const firstCall = (prisma as any).user.findFirst.mock.calls[0][0];
    expect(firstCall).toEqual({ where: { id: 'u3', tenantId: TENANT }, select: { status: true } });
  });

  it('returns an already disabled user unchanged (no admin check, no token invalidation, no audit)', async () => {
    const target: FakeUser = {
      id: 'u4',
      tenantId: TENANT,
      email: 'disabled@acme.test',
      status: 'DISABLED',
      lastLoginAt: new Date(),
      roles: [],
    };
    const prisma = fakePrisma({ users: [target], activeAdminCount: 0 });
    const svc = await build(prisma);
    const result = await svc.deactivate(TENANT, 'u4', 'actor1');
    expect(result.status).toBe('DISABLED');
    expect((prisma as any).user.updateMany).not.toHaveBeenCalled();
    expect((prisma as any).userActionToken.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('maps a Postgres serialization failure (P2034) to ConflictException', async () => {
    const target: FakeUser = {
      id: 'u-race',
      tenantId: TENANT,
      email: 'race@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [],
    };
    const prisma = fakePrisma({ users: [target] });
    const serializationFailure = new Prisma.PrismaClientKnownRequestError(
      'could not serialize access due to concurrent update',
      { code: 'P2034', clientVersion: '6.19.3' },
    );
    (prisma as any).$transaction = jest.fn(async () => {
      throw serializationFailure;
    });
    const svc = await build(prisma);
    await expect(svc.deactivate(TENANT, 'u-race', 'actor1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UsersService.update', () => {
  it('rejects removing the admin role from the last active admin', async () => {
    const target: FakeUser = {
      id: 'u5',
      tenantId: TENANT,
      email: 'admin3@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const svc = await build(fakePrisma({ users: [target], activeAdminCount: 1 }));
    await expect(
      svc.update(TENANT, 'u5', { roleIds: [OTHER_ROLE.id] } as any, 'actor1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows removing the admin role when another active admin remains', async () => {
    const target: FakeUser = {
      id: 'u6',
      tenantId: TENANT,
      email: 'admin4@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const svc = await build(fakePrisma({ users: [target], activeAdminCount: 2 }));
    const result = await svc.update(TENANT, 'u6', { roleIds: [OTHER_ROLE.id] } as any, 'actor1');
    expect(result).toBeDefined();
  });

  it('maps a Postgres serialization failure (P2034) to ConflictException', async () => {
    const target: FakeUser = {
      id: 'u6b',
      tenantId: TENANT,
      email: 'admin5@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const prisma = fakePrisma({ users: [target], activeAdminCount: 1 });
    const serializationFailure = new Prisma.PrismaClientKnownRequestError(
      'could not serialize access due to concurrent update',
      { code: 'P2034', clientVersion: '6.19.3' },
    );
    (prisma as any).$transaction = jest.fn(async () => {
      throw serializationFailure;
    });
    const svc = await build(prisma);
    await expect(
      svc.update(TENANT, 'u6b', { roleIds: [OTHER_ROLE.id] } as any, 'actor1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UsersService.resendInvitation', () => {
  it('rejects when the user is not INVITED', async () => {
    const target: FakeUser = {
      id: 'u7',
      tenantId: TENANT,
      email: 'active@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    await expect(svc.resendInvitation(TENANT, 'u7', 'actor1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('invalidates prior tokens, issues a new one and returns an inviteUrl', async () => {
    const target: FakeUser = {
      id: 'u8',
      tenantId: TENANT,
      email: 'invited@acme.test',
      status: 'INVITED',
      lastLoginAt: null,
      roles: [],
    };
    const prisma = fakePrisma({ users: [target] });
    const svc = await build(prisma);
    const before = Date.now();
    const result = await svc.resendInvitation(TENANT, 'u8', 'actor1');
    expect((prisma as any).userActionToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u8', kind: 'INVITATION', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect((prisma as any).userActionToken.create).toHaveBeenCalled();
    const createArgs = ((prisma as any).userActionToken.create as jest.Mock).mock.calls[0][0];
    const expiresAt = createArgs.data.expiresAt as Date;
    expect(expiresAt.getTime() - before).toBeGreaterThan(71 * 3600 * 1000);
    expect(expiresAt.getTime() - before).toBeLessThan(73 * 3600 * 1000);
    expect(mail.queue).toHaveBeenCalled();
    expect(result.inviteUrl).toContain('/reset-password/');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: 'actor1',
        entityType: 'user',
        entityId: 'u8',
        after: { invitationResent: true },
      }),
    );
    // Finding 7: no passwordHash in the lookup select.
    expect((prisma as any).user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u8', tenantId: TENANT },
      select: { id: true, email: true, status: true },
    });
  });
});

describe('UsersService.reactivate', () => {
  it('reactivates straight to ACTIVE when the user has logged in before', async () => {
    const target: FakeUser = {
      id: 'u9',
      tenantId: TENANT,
      email: 'was-active@acme.test',
      status: 'DISABLED',
      lastLoginAt: new Date(),
      roles: [],
    };
    const prisma = fakePrisma({ users: [target] });
    const svc = await build(prisma);
    const result = await svc.reactivate(TENANT, 'u9', 'actor1');
    expect(result.status).toBe('ACTIVE');
    expect((result as any).inviteUrl).toBeUndefined();
    expect((prisma as any).user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u9', tenantId: TENANT, status: 'DISABLED' },
      data: { status: 'ACTIVE' },
    });
    // Finding 7: no passwordHash in the lookup select.
    expect((prisma as any).user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u9', tenantId: TENANT },
      select: { id: true, email: true, status: true, lastLoginAt: true },
    });
  });

  it('reactivates to INVITED with a fresh invitation when never logged in', async () => {
    const target: FakeUser = {
      id: 'u10',
      tenantId: TENANT,
      email: 'never-logged-in@acme.test',
      status: 'DISABLED',
      lastLoginAt: null,
      roles: [],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    const result = await svc.reactivate(TENANT, 'u10', 'actor1');
    expect(result.status).toBe('INVITED');
    expect((result as any).inviteUrl).toContain('/reset-password/');
    expect((result as any).invitation).not.toBeNull();
  });

  it('rejects reactivating a user who is not disabled', async () => {
    const target: FakeUser = {
      id: 'u11',
      tenantId: TENANT,
      email: 'active2@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    await expect(svc.reactivate(TENANT, 'u11', 'actor1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('finding 3: returns the current user without auditing or re-inviting when the conditional update loses a race', async () => {
    const target: FakeUser = {
      id: 'u12',
      tenantId: TENANT,
      email: 'race@acme.test',
      status: 'DISABLED',
      lastLoginAt: null,
      roles: [],
    };
    const prisma = fakePrisma({ users: [target] });
    // Simulates another request having already flipped the row's status
    // between our findFirst and this updateMany.
    (prisma as any).user.updateMany = jest.fn(async () => ({ count: 0 }));
    const svc = await build(prisma);
    const result = await svc.reactivate(TENANT, 'u12', 'actor1');
    expect(result.status).toBe('DISABLED');
    expect(audit.log).not.toHaveBeenCalled();
    expect((prisma as any).userActionToken.create).not.toHaveBeenCalled();
    expect(mail.queue).not.toHaveBeenCalled();
  });
});

describe('UsersService.create — invitation projection (finding 4)', () => {
  it('returns a populated invitation (not null) for a freshly invited user', async () => {
    const prisma = fakePrisma({ users: [] });
    const svc = await build(prisma);
    const result: any = await svc.create(TENANT, {
      email: 'new@acme.test',
      firstName: 'New',
      lastName: 'User',
    } as any);
    expect(result.status).toBe('INVITED');
    expect(result.inviteUrl).toContain('/reset-password/');
    expect(result.invitation).not.toBeNull();
    expect(result.invitation.expired).toBe(false);
  });
});

describe('project() — via get() (finding 6)', () => {
  it('reports invitation: null for a non-INVITED user even with a stray unused token', async () => {
    const target: FakeUser = {
      id: 'u20',
      tenantId: TENANT,
      email: 'active3@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [],
      actionTokens: [{ expiresAt: new Date(Date.now() + 3600_000) }],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    const result: any = await svc.get(TENANT, 'u20');
    expect(result.invitation).toBeNull();
    expect(result.actionTokens).toBeUndefined();
  });

  it('reports invitation.expired = false for a future token', async () => {
    const target: FakeUser = {
      id: 'u21',
      tenantId: TENANT,
      email: 'invited2@acme.test',
      status: 'INVITED',
      lastLoginAt: null,
      roles: [],
      actionTokens: [{ expiresAt: new Date(Date.now() + 3600_000) }],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    const result: any = await svc.get(TENANT, 'u21');
    expect(result.invitation).toEqual({ expiresAt: target.actionTokens![0].expiresAt, expired: false });
    expect(result.actionTokens).toBeUndefined();
  });

  it('reports invitation.expired = true for a past token', async () => {
    const target: FakeUser = {
      id: 'u22',
      tenantId: TENANT,
      email: 'invited3@acme.test',
      status: 'INVITED',
      lastLoginAt: null,
      roles: [],
      actionTokens: [{ expiresAt: new Date(Date.now() - 3600_000) }],
    };
    const svc = await build(fakePrisma({ users: [target] }));
    const result: any = await svc.get(TENANT, 'u22');
    expect(result.invitation).toEqual({ expiresAt: target.actionTokens![0].expiresAt, expired: true });
    expect(result.actionTokens).toBeUndefined();
  });
});
