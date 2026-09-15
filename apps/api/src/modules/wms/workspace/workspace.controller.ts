import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { WmsPageQuery, WmsWorkspaceQuery, WmsSitesQuery } from './workspace.dto';
import { WmsWorkspaceService } from './workspace.service';
@ApiTags('wms/workspace')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms')
export class WmsWorkspaceController {
  constructor(private readonly service: WmsWorkspaceService) {}
  @Get('sites')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  sites(@CurrentUser() u: AuthUser, @Query() q: WmsSitesQuery) {
    return this.service.sites(u.tenantId, q);
  }
  @Get('sites/:id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  site(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.site(u.tenantId, id);
  }
  @Get('workspace')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  workspace(@CurrentUser() u: AuthUser, @Query() q: WmsWorkspaceQuery) {
    return this.service.workspace(u.tenantId, q);
  }
  @Get('workspace/bins/:id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  bin(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: WmsPageQuery) {
    return this.service.bin(u.tenantId, id, q);
  }
}
