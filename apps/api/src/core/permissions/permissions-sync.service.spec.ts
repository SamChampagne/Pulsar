import { PermissionsSyncService } from './permissions-sync.service';

function prismaMock() {
  return {
    permission: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{ id: 'p1', key: 'core.users.read' }, { id: 'p2', key: 'core.locations.read' }]),
    },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]) },
    rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
}

describe('PermissionsSyncService', () => {
  it('upserts every catalog permission and grants them to system admin roles', async () => {
    const prisma = prismaMock();
    const svc = new PermissionsSyncService(prisma as never);
    const res = await svc.sync();
    expect(prisma.permission.upsert).toHaveBeenCalled();
    expect(prisma.role.findMany).toHaveBeenCalledWith({ where: { isSystem: true, key: 'admin' }, select: { id: true } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.rolePermission.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(res.grantsAdded).toBe(4);
  });

  it('never throws (best-effort) when the database fails', async () => {
    const prisma = prismaMock();
    prisma.permission.upsert.mockRejectedValue(new Error('db down'));
    const svc = new PermissionsSyncService(prisma as never);
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
