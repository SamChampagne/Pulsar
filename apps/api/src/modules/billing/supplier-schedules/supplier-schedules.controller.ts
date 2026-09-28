import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, MODULE_KEYS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SupplierSchedulesService } from './supplier-schedules.service';
import {
  SupplierScheduleConfirmDto,
  SupplierSchedulePageDto,
  SupplierScheduleQueryDto,
  SupplierScheduleReviewDto,
} from './supplier-schedules.dto';
const R = 'billing.supplier-invoices.read',
  M = 'billing.supplier-schedules.manage';
@ApiTags('billing/supplier-schedules')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/supplier-schedules')
export class SupplierSchedulesController {
  constructor(private readonly service: SupplierSchedulesService) {}
  @Get() @RequirePermissions(R) list(
    @CurrentUser() u: AuthUser,
    @Query() q: SupplierScheduleQueryDto,
  ) {
    return this.service.list(u, q);
  }
  @Get('requests/:key') @RequirePermissions(R, M) request(
    @CurrentUser() u: AuthUser,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.service.request(u, key);
  }
  @Get('invoice/:id') @RequirePermissions(R) get(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.get(u, id);
  }
  @Get('invoice/:id/history') @RequirePermissions(R) history(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: SupplierSchedulePageDto,
  ) {
    return this.service.history(u, id, q);
  }
  @Post('invoice/:id/review') @RequirePermissions(R, M) review(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierScheduleReviewDto,
  ) {
    return this.service.review(u, id, d);
  }
  @Post('invoice/:id/confirm') @RequirePermissions(R, M) confirm(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierScheduleConfirmDto,
  ) {
    return this.service.confirm(u, id, d);
  }
}
