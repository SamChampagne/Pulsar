import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, ModuleKey } from '@pulsar/shared';
import { MODULE_KEYS } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MODULE_KEY } from '../decorators/require-module.decorator';

/**
 * Blocks access to endpoints of a business module unless the module is enabled
 * for the caller's tenant. The `core` module is always allowed.
 * TODO(phase-2): cache tenant→modules lookups (per-request DB hit today).
 */
@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<ModuleKey>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleKey || moduleKey === MODULE_KEYS.CORE) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return false;

    const activation = await this.prisma.tenantModule.findFirst({
      where: { tenantId: user.tenantId, enabled: true, module: { key: moduleKey } },
    });
    if (!activation) {
      throw new ForbiddenException(`Module "${moduleKey}" is not enabled for this tenant`);
    }
    return true;
  }
}
