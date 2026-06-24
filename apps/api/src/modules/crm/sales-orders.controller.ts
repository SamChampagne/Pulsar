import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, SalesOrderStatus } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto, SalesOrderListQueryDto, UpdateSalesOrderDto } from './dto/sales-order.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: SalesOrderListQueryDto) {
    return this.service.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesOrderDto) {
    return this.service.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.service.update(user.tenantId, user.id, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.transition(user.tenantId, user.id, id, SalesOrderStatus.CONFIRMED);
  }

  @Post(':id/fulfill')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  fulfill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.transition(user.tenantId, user.id, id, SalesOrderStatus.FULFILLED);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.transition(user.tenantId, user.id, id, SalesOrderStatus.CANCELLED);
  }
}
