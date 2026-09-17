import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

function fakePrisma(opts: {
  users: FakeUser[];
  activeAdminCount?: number;
}) {
  const users = opts.users;
  const updateMany = jest.fn(async ({ where, data }: any) => {
    const match = users.find(
      (u) =>
        u.id === where.id &&
        u.tenantId === where.tenantId &&
        (where.status?.not === undefined || u.status !== where.status.not),
    );
    if (!match) return { count: 0 };
    Object.assign(match, data);
    return { count: 1 };
  });
  const update = jest.fn(async ({ where, data }: any) => {
    const match = users.find((u) => u.id === where.id);
    if (match) Object.assign(match, data);
    return { ...match, actionTokens: [] };
  });
  const findFirst = jest.fn(async ({ where }: any) => {
    return users.find((u) => u.id === where.id && (where.tenantId ? u.tenantId === where.tenantId : true)) ?? null;
  });
  const count = jest.fn(async () => opts.activeAdminCount ?? 0);
  const userActionTokenUpdateMany = jest.fn(async () => ({ count: 1 }));
  const userActionTokenCreate = jest.fn(async ({ data }: any) => ({ id: 'token1', ...data }));

  const prisma = {
    user: { findFirst, update, updateMany, count },
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

  it('rejects deactivating the last active admin', async () => {
    const target: FakeUser = {
      id: 'u2',
      tenantId: TENANT,
      email: 'admin@acme.test',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      roles: [{ role: ADMIN_ROLE }],
    };
    const svc = await build(fakePrisma({ users: [target], activeAdminCount: 1 }));
    await expect(svc.deactivate(TENANT, 'u2', 'actor1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates when another active admin remains', async () => {
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
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: 'actor1',
        entityType: 'user',
        entityId: 'u3',
        before: { status: 'ACTIVE' },
        after: { status: 'DISABLED' },
      }),
    );
  });

  it('returns an already disabled user unchanged', async () => {
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
    expect(audit.log).not.toHaveBeenCalled();
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
    const svc = await build(fakePrisma({ users: [target] }));
    const result = await svc.reactivate(TENANT, 'u9', 'actor1');
    expect(result.status).toBe('ACTIVE');
    expect((result as any).inviteUrl).toBeUndefined();
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
});
