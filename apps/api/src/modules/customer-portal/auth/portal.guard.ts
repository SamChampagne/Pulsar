import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PortalAuthUser, PortalUserRole } from '@pulsar/shared';
import { MODULE_KEYS, PortalUserStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import type { PortalTokenClaims } from './portal-jwt.strategy';

/**
 * Customer-portal-plane guard. On top of the portal-jwt strategy, the account
 * is re-read from the database on EVERY request (same reasoning as
 * PlatformGuard): portal access tokens live 8 h, so a DISABLED account, a
 * deactivated customer company or a module switched off must take effect
 * immediately — not at the next refresh.
 *
 * Portal routes are `@Public()` (they bypass the global tenant guards), so the
 * module activation check ModulesGuard would normally do is repeated here
 * (CLAUDE.md rule 15).
 */
@Injectable()
export class PortalGuard extends AuthGuard('portal-jwt') {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const request = context.switchToHttp().getRequest();
    const claims = request.user as PortalTokenClaims;

    // Scoped by tenant AND customer: a token must never reach an account of
    // another tenant, nor one that has since been moved (rule 1).
    const portalUser = await this.prisma.portalUser.findFirst({
      where: { id: claims.id, tenantId: claims.tenantId, customerId: claims.customerId },
      include: { customer: { select: { isActive: true, name: true } } },
    });
    if (!portalUser || portalUser.status !== PortalUserStatus.ACTIVE) {
      throw new UnauthorizedException('Portal account is not active');
    }
    if (!portalUser.customer?.isActive) {
      throw new UnauthorizedException('Portal account is not active');
    }

    const enabled = await this.modulesCache.getEnabledKeys(portalUser.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException('The customer portal is not enabled for this shipper');
    }

    const portalAuthUser: PortalAuthUser = {
      id: portalUser.id,
      tenantId: portalUser.tenantId,
      customerId: portalUser.customerId,
      email: portalUser.email,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      role: portalUser.role as PortalUserRole,
    };
    request.portalUser = portalAuthUser;
    // Passport wrote the raw token claims to request.user; they are cleared so
    // nothing downstream (@CurrentUser, interceptors, the audit interceptor) can
    // mistake a portal identity for a tenant AuthUser — a PortalUser id is not a
    // User id and must never reach `AuditLog.userId`.
    request.user = undefined;
    return true;
  }
}
