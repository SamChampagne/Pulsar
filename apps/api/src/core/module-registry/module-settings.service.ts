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

  private async moduleId(moduleKey: string): Promise<string> {
    const def = await this.prisma.moduleDefinition.findUnique({ where: { key: moduleKey } });
    if (!def) throw new NotFoundException(`Unknown module "${moduleKey}"`);
    return def.id;
  }

  async resolve(tenantId: string, moduleKey: string): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) return {};
    const id = await this.moduleId(moduleKey);
    const stored = await this.cache.getRawSettings(tenantId, id);
    return resolveSettings(cat, stored);
  }

  async update(tenantId: string, moduleKey: string, patch: Record<string, unknown>): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) throw new NotFoundException(`No settings for module "${moduleKey}"`);
    const res = validateSettings(cat, patch);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    const id = await this.moduleId(moduleKey);
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
