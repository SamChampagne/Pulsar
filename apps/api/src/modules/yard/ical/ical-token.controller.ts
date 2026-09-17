import { Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import type { Request } from 'express';
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
   * POST /yard/ical-token — (re)generates the tenant's yard iCal feed token.
   * Rotating replaces the previous token, invalidating the old URL.
   */
  @Post('ical-token')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  async generate(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const { token } = await this.ical.generateToken(user.tenantId);
    const url = `${req.protocol}://${req.get('host')}/api/v1/public/ical/yard/${token}`;
    return { token, url };
  }
}
