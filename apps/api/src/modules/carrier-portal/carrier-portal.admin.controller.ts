import { Controller, Delete, Post, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CarrierPortalService } from './carrier-portal.service';

/**
 * Admin endpoints for managing carrier portal links.
 * Gated by the CARRIER_PORTAL module and LINKS_MANAGE permission.
 * tenantId is always taken from the authenticated user's JWT (rule 1).
 */
@ApiTags('carrier-portal')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CARRIER_PORTAL)
@Controller('carrier-portal/carriers')
export class CarrierPortalAdminController {
  constructor(private readonly carrierPortal: CarrierPortalService) {}

  /** Generate (or return existing) a portal link for a carrier. */
  @Post(':carrierId/portal-link')
  @RequirePermissions(PERMISSIONS.CARRIER_PORTAL.LINKS_MANAGE)
  generateLink(
    @CurrentUser() user: AuthUser,
    @Param('carrierId') carrierId: string,
  ) {
    return this.carrierPortal.generateLink(user.tenantId, carrierId);
  }

  /** Revoke the portal link for a carrier (token is set to null). */
  @Delete(':carrierId/portal-link')
  @RequirePermissions(PERMISSIONS.CARRIER_PORTAL.LINKS_MANAGE)
  revokeLink(
    @CurrentUser() user: AuthUser,
    @Param('carrierId') carrierId: string,
  ) {
    return this.carrierPortal.revokeLink(user.tenantId, carrierId);
  }
}
