import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RolesService } from './roles.service';

function fakePrisma(opts: {
  existingKeys?: string[];
  permissionKeys?: string[];
  role?: any;
  createResult?: any;
}) {
  const existingKeys = opts.existingKeys ?? [];
  const permissionKeys = opts.permissionKeys ?? [];
  const role = opts.role;
  return {
    role: {
      findMany: async () => existingKeys.map((key) => ({ key })),
      findUnique: async () => null,
      findFirst: async () => role ?? null,
      create: async ({ data }: any) =>
        opts.createResult ?? { id: 'new-role-id', ...data, _count: { users: 0 } },
      delete: async () => role,
    },
    permission: {
      findMany: async ({ where }: any) => {
        const keys: string[] = where.key.in;
        return keys
          .filter((k) => permissionKeys.includes(k))
          .map((k) => ({ id: `${k}-id`, key: k }));
      },
    },
  } as unknown as PrismaService;
}

const auditLogs = { log: async () => undefined } as unknown as AuditLogsService;

function tenantModules(enabled: string[]) {
  return {
    getEnabledKeys: async () => new Set(enabled),
  } as unknown as TenantModulesCacheService;
}

async function build(prisma: PrismaService, modules: TenantModulesCacheService) {
  const m = await Test.createTestingModule({
    providers: [
      RolesService,
      { provide: PrismaService, useValue: prisma },
      { provide: TenantModulesCacheService, useValue: modules },
      { provide: AuditLogsService, useValue: auditLogs },
    ],
  }).compile();
  return m.get(RolesService);
}

describe('RolesService.createFromTemplate', () => {
  it('rejects an unknown or unavailable template key with 400', async () => {
    const svc = await build(fakePrisma({}), tenantModules([]));
    await expect(svc.createFromTemplate('ten1', 'not-a-template')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a template gated behind a module the tenant has not enabled', async () => {
    const svc = await build(fakePrisma({}), tenantModules([]));
    await expect(svc.createFromTemplate('ten1', 'billing-clerk')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('delegates to create() with the resolved template permission keys', async () => {
    const permissionKeys = [
      'billing.supplier-invoices.read',
      'billing.supplier-invoices.manage',
      'billing.supplier-credits.manage',
      'billing.invoices.read',
      'billing.invoices.manage',
      'billing.invoices.pay',
      'billing.freight-audit.read',
      'billing.freight-audit.manage',
      'billing.customer-invoices.read',
      'billing.customer-invoices.manage',
      'billing.customer-invoices.send',
      'billing.customer-invoices.pay',
      'billing.payments.read',
      'billing.payments.manage',
      'billing.taxes.read',
      'billing.subscriptions.read',
      'billing.ledger.read',
      'core.documents.read',
    ];
    const prisma = fakePrisma({ permissionKeys });
    let created: any = null;
    (prisma as any).role.create = async ({ data }: any) => {
      created = data;
      return { id: 'new-role-id', ...data, _count: { users: 0 } };
    };
    const svc = await build(prisma, tenantModules(['billing']));

    const result = await svc.createFromTemplate('ten1', 'billing-clerk');

    expect(result.id).toBe('new-role-id');
    expect(created.key).toBe('billing-clerk');
    expect(created.name).toBe('Commis à la facturation');
    expect(created.permissions.create).toHaveLength(permissionKeys.length);
  });
});

describe('RolesService.remove', () => {
  it('rejects deleting a role that is still assigned to users with 400', async () => {
    const role = {
      id: 'r1',
      tenantId: 'ten1',
      key: 'dispatcher',
      name: 'Dispatcher',
      isSystem: false,
      _count: { users: 3 },
    };
    const svc = await build(fakePrisma({ role }), tenantModules([]));
    await expect(svc.remove('ten1', 'r1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.remove('ten1', 'r1')).rejects.toThrow('Role is assigned to 3 user(s)');
  });

  it('rejects deleting a system role regardless of assignment count', async () => {
    const role = {
      id: 'r1',
      tenantId: 'ten1',
      key: 'admin',
      name: 'Admin',
      isSystem: true,
      _count: { users: 0 },
    };
    const svc = await build(fakePrisma({ role }), tenantModules([]));
    await expect(svc.remove('ten1', 'r1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes a system-free, unassigned role', async () => {
    const role = {
      id: 'r1',
      tenantId: 'ten1',
      key: 'viewer',
      name: 'Viewer',
      isSystem: false,
      _count: { users: 0 },
    };
    const svc = await build(fakePrisma({ role }), tenantModules([]));
    await expect(svc.remove('ten1', 'r1', 'user1')).resolves.toEqual({ deleted: true });
  });
});
