import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DealsService } from './deals.service';
import { SalesOrdersService } from './sales-orders.service';
import { AdvanceDealDto, CreateDealDto, DealListQueryDto, UpdateDealDto } from './dto/deal.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/deals')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: DealListQueryDto) {
    return this.deals.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deals.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDealDto) {
    return this.deals.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDealDto) {
    return this.deals.update(user.tenantId, user.id, id, dto);
  }

  @Post(':id/advance')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  advance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdvanceDealDto) {
    return this.deals.advance(user.tenantId, id, user.id, dto.stage);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deals.convert(user.tenantId, id, user.id);
  }

  @Post(':id/create-sales-order')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  createSalesOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.salesOrders.createFromDeal(user.tenantId, user.id, id);
  }
}
