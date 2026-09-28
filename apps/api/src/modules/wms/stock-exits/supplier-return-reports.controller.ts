import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { SupplierReturnReportsService } from './supplier-return-reports.service';
import { SupplierReturnReportDto } from './supplier-return-reports.dto';
@ApiTags('wms/stock-exits')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/stock-exits/:id/supplier-reports')
export class SupplierReturnReportsController {
  constructor(private readonly service: SupplierReturnReportsService) {}
  @Get() @RequirePermissions('wms.read') list(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: ListQueryDto,
  ) {
    return this.service.list(u.tenantId, id, q);
  }
  @Get('requests/:key') @RequirePermissions('wms.read', 'wms.manage', 'wms.stock.return') request(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.service.request(u, id, key);
  }
  @Post() @RequirePermissions('wms.read', 'wms.manage', 'wms.stock.return') create(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierReturnReportDto,
  ) {
    return this.service.create(u, id, d);
  }
}
