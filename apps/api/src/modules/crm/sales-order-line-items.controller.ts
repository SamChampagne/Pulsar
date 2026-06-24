import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SalesOrderLineItemsService } from './sales-order-line-items.service';
import { CreateSalesOrderLineItemDto, UpdateSalesOrderLineItemDto } from './dto/sales-order-line-item.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/sales-orders/:soId/line-items')
export class SalesOrderLineItemsController {
  constructor(private readonly service: SalesOrderLineItemsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Param('soId') soId: string) {
    return this.service.list(user.tenantId, soId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(
    @CurrentUser() user: AuthUser,
    @Param('soId') soId: string,
    @Body() dto: CreateSalesOrderLineItemDto,
  ) {
    return this.service.create(user.tenantId, user.id, soId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('soId') soId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSalesOrderLineItemDto,
  ) {
    return this.service.update(user.tenantId, user.id, soId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('soId') soId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(user.tenantId, user.id, soId, id);
  }
}
