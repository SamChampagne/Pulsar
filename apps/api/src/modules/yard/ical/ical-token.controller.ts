import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { YardIcalService } from './ical.service';

@ApiTags('yard/ical')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard')
export class YardIcalTokenController {
  constructor(private readonly ical: YardIcalService) {}

  /**
   * GET /yard/ical-token — reload-safe status. Never returns the token or the
   * URL (rule 10) — only whether a feed link exists and when it was last
   * (re)generated, so the config page can render "Générer" vs "Régénérer"
   * correctly after a page reload.
   */
  @Get('ical-token')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  status(@CurrentUser() user: AuthUser) {
    return this.ical.getStatus(user.tenantId);
  }

  /**
   * POST /yard/ical-token — (re)generates the tenant's yard iCal feed token.
   * Rotating replaces the previous token, invalidating the old URL. The
   * public URL is built from config (API_URL), never from the request's
   * protocol/host.
   */
  @Post('ical-token')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  async generate(@CurrentUser() user: AuthUser) {
    const { token } = await this.ical.generateToken(user.tenantId, user.id);
    return { token, url: this.ical.buildPublicUrl(token) };
  }
}
