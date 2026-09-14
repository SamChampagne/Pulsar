import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SaveYardPlanDto, WorkspaceQueryDto } from './workspace.dto';
import { YardWorkspaceService } from './workspace.service';

@ApiTags('yard')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard')
export class YardWorkspaceController {
  constructor(private readonly service: YardWorkspaceService) {}
  @Get('sites')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  sites(@CurrentUser() u: AuthUser) {
    return this.service.sites(u.tenantId);
  }
  @Get('workspace')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  read(@CurrentUser() u: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.service.read(u.tenantId, query);
  }
  @Put('sites/:id/plan')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SaveYardPlanDto) {
    return this.service.savePlan(u.tenantId, u.id, id, dto);
  }
}
