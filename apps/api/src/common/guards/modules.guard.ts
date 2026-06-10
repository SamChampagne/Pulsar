import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, ModuleKey } from '@pulsar/shared';
import { MODULE_KEYS } from '@pulsar/shared';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { MODULE_KEY } from '../decorators/require-module.decorator';

/**
 * Blocks access to endpoints of a business module unless the module is enabled
 * for the caller's tenant. The `core` module is always allowed.
 * Lookups go through a 30s in-memory cache, invalidated on module toggle.
 */
@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<ModuleKey>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleKey || moduleKey === MODULE_KEYS.CORE) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return false;

    const enabled = await this.modulesCache.getEnabledKeys(user.tenantId);
    if (!enabled.has(moduleKey)) {
      throw new ForbiddenException(`Module "${moduleKey}" is not enabled for this tenant`);
    }
    return true;
  }
}
