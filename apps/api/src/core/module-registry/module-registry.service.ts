import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

@Injectable()
export class ModuleRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  /** Full catalog with the activation state for the given tenant. */
  async listForTenant(tenantId: string) {
    const [definitions, activations] = await this.prisma.$transaction([
      this.prisma.moduleDefinition.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.tenantModule.findMany({ where: { tenantId } }),
    ]);
    const byModuleId = new Map(activations.map((a) => [a.moduleId, a]));
    return definitions.map((def) => ({
      ...def,
      enabled: def.isCore || (byModuleId.get(def.id)?.enabled ?? false),
      enabledAt: byModuleId.get(def.id)?.enabledAt ?? null,
    }));
  }

  async setEnabled(tenantId: string, moduleKey: string, enabled: boolean) {
    const definition = await this.prisma.moduleDefinition.findUnique({
      where: { key: moduleKey },
    });
    if (!definition) throw new NotFoundException(`Unknown module "${moduleKey}"`);
    if (definition.isCore) throw new BadRequestException('The core module cannot be toggled');
    if (enabled && !definition.available) {
      throw new BadRequestException(`Module "${moduleKey}" is not available yet`);
    }

    // Nested upsert + include may be emulated by Prisma and race on first activation.
    // INSERT ... ON CONFLICT DO NOTHING, then update under the same transaction.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.tenantModule.createMany({
        data: [{ tenantId, moduleId: definition.id, enabled: false }],
        skipDuplicates: true,
      });
      return tx.tenantModule.update({
        where: { tenantId_moduleId: { tenantId, moduleId: definition.id } },
        data: { enabled, enabledAt: enabled ? new Date() : undefined },
        include: { module: true },
      });
    });
    this.modulesCache.invalidate(tenantId);
    return result;
  }
}
