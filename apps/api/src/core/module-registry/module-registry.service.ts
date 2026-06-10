import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ModuleRegistryService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: definition.id } },
      update: { enabled, enabledAt: enabled ? new Date() : undefined },
      create: {
        tenantId,
        moduleId: definition.id,
        enabled,
        enabledAt: enabled ? new Date() : null,
      },
      include: { module: true },
    });
  }
}
