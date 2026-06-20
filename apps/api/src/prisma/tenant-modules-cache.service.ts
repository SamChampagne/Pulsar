import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const TTL_MS = 30_000;

interface CacheEntry {
  keys: Set<string>;
  expiresAt: number;
}

/**
 * Short-TTL in-memory cache of the enabled module keys per tenant, so
 * ModulesGuard does not hit the database on every request. Toggling a module
 * invalidates the entry immediately (single-process; revisit with Redis when
 * the API scales horizontally).
 */
@Injectable()
export class TenantModulesCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly settingsCache = new Map<string, { settings: Record<string, unknown>; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getEnabledKeys(tenantId: string): Promise<Set<string>> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > Date.now()) return hit.keys;

    const rows = await this.prisma.tenantModule.findMany({
      where: { tenantId, enabled: true },
      select: { module: { select: { key: true } } },
    });
    const keys = new Set(rows.map((r) => r.module.key));
    this.cache.set(tenantId, { keys, expiresAt: Date.now() + TTL_MS });
    return keys;
  }

  async getRawSettings(tenantId: string, moduleId: string): Promise<Record<string, unknown>> {
    const ck = `${tenantId}:${moduleId}`;
    const hit = this.settingsCache.get(ck);
    if (hit && hit.expiresAt > Date.now()) return hit.settings;
    const row = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      select: { settings: true },
    });
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    this.settingsCache.set(ck, { settings, expiresAt: Date.now() + TTL_MS });
    return settings;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    for (const k of this.settingsCache.keys()) {
      if (k.startsWith(`${tenantId}:`)) this.settingsCache.delete(k);
    }
  }
}
