import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { INBOUND_HOOK_TARGETS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IntegrationsService } from './integrations.service';

/**
 * Staff side of the inbound webhook receiver: issue (and rotate) the token a
 * partner posts to. The raw token is returned ONCE — only its sha256 is stored,
 * in the `Integration.inboundTokenHash` column (never in the config blob, which
 * cannot be indexed).
 */
@ApiTags('core/integrations')
@ApiBearerAuth()
@Controller('integrations')
export class InboundHooksAdminController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** Catalog of the business writes an inbound receiver can feed. */
  @Get('inbound-targets')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_READ)
  targets() {
    return INBOUND_HOOK_TARGETS;
  }

  /**
   * Generates a fresh inbound token and returns it once, with the URL to hand
   * to the partner. Re-issuing ROTATES: the previous token stops working.
   */
  @Post(':id/inbound-token')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.issueInboundToken(user.tenantId, id, user.id);
  }
}
