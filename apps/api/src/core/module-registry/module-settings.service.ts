import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  catalogFor,
  resolveSettings,
  validateSettings,
  type ResolvedSettings,
  type SettingDescriptor,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

@Injectable()
export class ModuleSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantModulesCacheService,
  ) {}

  descriptors(moduleKey: string): SettingDescriptor[] {
    const cat = catalogFor(moduleKey);
    if (!cat) throw new NotFoundException(`No settings for module "${moduleKey}"`);
    return cat.settings;
  }

  /**
   * Returns the moduleDefinition id to use as the storage row for `moduleKey`.
   *
   * - If a `moduleDefinition` row exists for `moduleKey` (i.e. a real business
   *   module like `procurement`), return its own id — settings are stored there.
   * - If no row exists (e.g. `connect` is a core sub-feature with no
   *   moduleDefinition), fall back to the `core` module's id so that writes land
   *   on the core TenantModule row (which always exists after seeding).
   * - Throws NotFoundException only if neither the module's row nor the `core`
   *   row can be found (should never happen on a seeded DB).
   */
  private async storageModuleId(moduleKey: string): Promise<string> {
    const def = await this.prisma.moduleDefinition.findUnique({ where: { key: moduleKey } });
    if (def) return def.id;
    const core = await this.prisma.moduleDefinition.findUnique({ where: { key: 'core' } });
    if (!core) throw new NotFoundException(`Module "${moduleKey}" has no definition row and the core module is missing`);
    return core.id;
  }

  async resolve(tenantId: string, moduleKey: string): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) return {};
    const storageId = await this.storageModuleId(moduleKey);
    const stored = await this.cache.getRawSettings(tenantId, storageId);
    return resolveSettings(cat, stored);
  }

  async update(tenantId: string, moduleKey: string, patch: Record<string, unknown>): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) throw new NotFoundException(`No settings for module "${moduleKey}"`);
    const res = validateSettings(cat, patch);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    const id = await this.storageModuleId(moduleKey);
    const existing = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: id } },
      select: { settings: true },
    });
    const merged = { ...((existing?.settings ?? {}) as Record<string, unknown>), ...res.value };
    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: id } },
      update: { settings: merged as Prisma.InputJsonValue },
      create: { tenantId, moduleId: id, enabled: false, settings: merged as Prisma.InputJsonValue },
    });
    this.cache.invalidate(tenantId);
    return resolveSettings(cat, merged);
  }
}
