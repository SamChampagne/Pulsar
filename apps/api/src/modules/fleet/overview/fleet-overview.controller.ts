import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FleetOverviewService } from './fleet-overview.service';

@ApiTags('fleet')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.FLEET)
@Controller('fleet/overview')
export class FleetOverviewController {
  constructor(private readonly overview: FleetOverviewService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  get(@CurrentUser() user: AuthUser) {
    return this.overview.overview(user.tenantId);
  }
}
