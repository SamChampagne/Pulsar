import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PERMISSION_CATALOG } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Keeps the Permission table aligned with the shared catalog and grants every
 * catalog permission to each tenant's system `admin` role. Idempotent,
 * best-effort: a failure is logged, never fatal (the seed remains the
 * authoritative path for a fresh database).
 */
@Injectable()
export class PermissionsSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionsSyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const res = await this.sync();
      this.logger.log(`Permissions synced (${res.permissionsUpserted} keys, ${res.grantsAdded} admin grants added)`);
    } catch (err) {
      this.logger.error(`Permission sync failed: ${(err as Error).message}`);
    }
  }

  async sync() {
    for (const p of PERMISSION_CATALOG) {
      await this.prisma.permission.upsert({
        where: { key: p.key },
        update: { module: p.module, description: p.description },
        create: { key: p.key, module: p.module, description: p.description },
      });
    }
    const permissions = await this.prisma.permission.findMany({ select: { id: true } });
    const adminRoles = await this.prisma.role.findMany({ where: { isSystem: true, key: 'admin' }, select: { id: true } });
    let grantsAdded = 0;
    for (const role of adminRoles) {
      const res = await this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      grantsAdded += res.count;
    }
    return { permissionsUpserted: PERMISSION_CATALOG.length, grantsAdded };
  }
}
