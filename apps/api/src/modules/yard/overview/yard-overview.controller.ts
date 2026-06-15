import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { YardOverviewService } from './yard-overview.service';

@ApiTags('yard')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard')
export class YardOverviewController {
  constructor(private readonly svc: YardOverviewService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  overview(@CurrentUser() user: AuthUser) {
    return this.svc.overview(user.tenantId);
  }

  @Get('board')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  board(@CurrentUser() user: AuthUser, @Query('locationId') locationId?: string) {
    return this.svc.board(user.tenantId, locationId);
  }
}
