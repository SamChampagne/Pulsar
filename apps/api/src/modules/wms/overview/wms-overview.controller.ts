import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { WmsOverviewService } from './wms-overview.service';

@ApiTags('wms')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/overview')
export class WmsOverviewController {
  constructor(private readonly svc: WmsOverviewService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser) {
    return this.svc.overview(user.tenantId);
  }
}
