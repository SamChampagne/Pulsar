import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, AuditAction, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import {
  MrpCalculateDto,
  MrpEntryDto,
  MrpPolicyDto,
  MrpSiteDto,
  MrpSalesDemandDto,
  MrpSourcesQuery,
  MrpProductMappingDto,
  MrpMappingsQuery,
} from './mrp.dto';
import { MrpService } from './mrp.service';
import { MrpDemandsService } from './mrp-demands.service';
import { MrpAssistanceService } from './mrp-assistance.service';

@ApiTags('manufacturing/mrp')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/mrp')
export class MrpController {
  constructor(
    private readonly service: MrpService,
    private readonly demands: MrpDemandsService,
    private readonly assistance: MrpAssistanceService,
  ) {}
  @Get('runs/:id/assistance')
  @RequirePermissions(
    PERMISSIONS.MANUFACTURING.READ,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.CORE.OPERATING_TASKS_READ,
  )
  assistanceState(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assistance.state(user.tenantId, id, user.permissions);
  }
  @Post('runs/:id/request-review')
  @RequirePermissions(
    PERMISSIONS.MANUFACTURING.READ,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.CORE.OPERATING_TASKS_READ,
    PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
  )
  requestReview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assistance.request(user.tenantId, user.id, id, user.permissions);
  }
  @Get('product-mappings')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ, PERMISSIONS.CRM.READ)
  mappings(@CurrentUser() user: AuthUser, @Query() query: MrpMappingsQuery) {
    return this.demands.mappings(user.tenantId, user.permissions, query);
  }
  @Put('product-mappings')
  @Audit('mrp-product-mapping', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ, PERMISSIONS.CRM.READ)
  mapping(@CurrentUser() user: AuthUser, @Body() dto: MrpProductMappingDto) {
    return this.demands.saveMapping(user.tenantId, user.id, user.permissions, dto);
  }
  @Get('sales-sources')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ, PERMISSIONS.CRM.READ)
  sources(@CurrentUser() user: AuthUser, @Query() query: MrpSourcesQuery) {
    return this.demands.sources(user.tenantId, user.permissions, query, query.salesOrderId);
  }
  @Post('sales-demands')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ, PERMISSIONS.CRM.READ)
  salesDemand(@CurrentUser() user: AuthUser, @Body() dto: MrpSalesDemandDto) {
    return this.demands.save(user.tenantId, user.id, user.permissions, dto);
  }
  @Put('sales-demands/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ, PERMISSIONS.CRM.READ)
  updateSalesDemand(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MrpSalesDemandDto,
  ) {
    return this.demands.save(user.tenantId, user.id, user.permissions, dto, id);
  }
  @Get('options')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  options(@CurrentUser() user: AuthUser) {
    return this.service.options(user.tenantId);
  }
  @Get('workspace')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  workspace(@CurrentUser() user: AuthUser, @Query() query: MrpSiteDto) {
    return this.service.workspace(user.tenantId, query.locationId, user.permissions);
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
    return this.service.calculate(user.tenantId, user.id, dto, user.permissions);
  }
  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getRun(user.tenantId, id, user.permissions);
  }
}
