import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, AuditAction, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { MrpCalculateDto, MrpEntryDto, MrpPolicyDto, MrpSiteDto } from './mrp.dto';
import { MrpService } from './mrp.service';

@ApiTags('manufacturing/mrp')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/mrp')
export class MrpController {
  constructor(private readonly service: MrpService) {}
  @Get('options')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  options(@CurrentUser() user: AuthUser) {
    return this.service.options(user.tenantId);
  }
  @Get('workspace')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  workspace(@CurrentUser() user: AuthUser, @Query() query: MrpSiteDto) {
    return this.service.workspace(user.tenantId, query.locationId);
  }
  @Put('policies')
  @Audit('mrp-policy', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ)
  policy(@CurrentUser() user: AuthUser, @Body() dto: MrpPolicyDto) {
    return this.service.savePolicy(user.tenantId, user.id, dto);
  }
  @Post('entries')
  @Audit('mrp-entry', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ)
  create(@CurrentUser() user: AuthUser, @Body() dto: MrpEntryDto) {
    return this.service.saveEntry(user.tenantId, user.id, dto);
  }
  @Put('entries/:id')
  @Audit('mrp-entry', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MrpEntryDto) {
    return this.service.saveEntry(user.tenantId, user.id, dto, id);
  }
  @Post('runs')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ)
  calculate(@CurrentUser() user: AuthUser, @Body() dto: MrpCalculateDto) {
    return this.service.calculate(user.tenantId, user.id, dto);
  }
  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getRun(user.tenantId, id);
  }
}
