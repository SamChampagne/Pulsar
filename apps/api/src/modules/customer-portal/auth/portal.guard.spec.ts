import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MODULE_KEYS, PortalUserRole } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { PortalGuard } from './portal.guard';

const CLAIMS = {
  id: 'pu1',
  tenantId: 't1',
  customerId: 'c1',
  email: 'jane@acme-client.test',
  role: PortalUserRole.MEMBER,
};

const DB_ROW = {
  id: 'pu1',
  tenantId: 't1',
  customerId: 'c1',
  email: 'jane@acme-client.test',
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'ADMIN',
  status: 'ACTIVE',
  customer: { isActive: true, name: 'Acme Client' },
};

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(row: unknown, enabled: string[] = [MODULE_KEYS.CUSTOMER_PORTAL]) {
  const findFirst = jest.fn().mockResolvedValue(row);
  const prisma = { portalUser: { findFirst } } as unknown as PrismaService;
  const cache = {
    getEnabledKeys: jest.fn().mockResolvedValue(new Set(enabled)),
  } as unknown as TenantModulesCacheService;
  return { guard: new PortalGuard(prisma, cache), findFirst, cache };
}

describe('PortalGuard', () => {
  let parentCanActivate: jest.SpyInstance;

  beforeEach(() => {
    const parentProto = Object.getPrototypeOf(PortalGuard.prototype);
    parentCanActivate = jest
      .spyOn(parentProto, 'canActivate')
      .mockImplementation(async (ctx: unknown) => {
        (ctx as ExecutionContext).switchToHttp().getRequest().user = { ...CLAIMS };
        return true;
      });
  });

  afterEach(() => {
    parentCanActivate.mockRestore();
  });

  it('re-reads the account scoped by id + tenantId + customerId and populates request.portalUser', async () => {
    const { guard, findFirst, cache } = makeGuard(DB_ROW);
    const request: Record<string, unknown> = {};

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'pu1', tenantId: 't1', customerId: 'c1' },
      include: { customer: { select: { isActive: true, name: true } } },
    });
    expect(cache.getEnabledKeys).toHaveBeenCalledWith('t1');
    // Fresh identity from the DB — never the (possibly stale) token claims.
    expect(request.portalUser).toEqual({
      id: 'pu1',
      tenantId: 't1',
      customerId: 'c1',
      email: 'jane@acme-client.test',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'ADMIN',
    });
  });

  it('401s when the account no longer exists', async () => {
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s on a DISABLED account', async () => {
    const { guard } = makeGuard({ ...DB_ROW, status: 'DISABLED' });
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s on an INVITED (not yet activated) account', async () => {
    const { guard } = makeGuard({ ...DB_ROW, status: 'INVITED' });
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s when the customer company is inactive', async () => {
    const { guard } = makeGuard({ ...DB_ROW, customer: { isActive: false, name: 'Acme Client' } });
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('403s when the customer-portal module is disabled for the tenant (rule 15)', async () => {
    const { guard } = makeGuard(DB_ROW, ['transportation']);
    const request: Record<string, unknown> = {};
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.portalUser).toBeUndefined();
  });

  it('denies when the passport layer denies', async () => {
    parentCanActivate.mockResolvedValue(false);
    const { guard, findFirst } = makeGuard(DB_ROW);
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
