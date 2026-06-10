import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('transportation/analytics')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('carriers')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ANALYTICS_READ)
  carriers(@CurrentUser() user: AuthUser) {
    return this.analytics.carrierScorecards(user.tenantId);
  }
}
