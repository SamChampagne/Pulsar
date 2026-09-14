import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, TransportOrderStatus } from '@pulsar/shared';
import { IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import {
  CreateTransportOrderDto,
  CreateTransportOrderFromSalesOrderDto,
  PlanTransportOrderDto,
  ShipmentSplitDto,
  UpdateTransportOrderDto,
} from './dto/transport-order.dto';
import { TransportOrdersService } from './transport-orders.service';

class OrderListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(TransportOrderStatus)
  status?: TransportOrderStatus;
}

@ApiTags('transportation/transport-orders')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/transport-orders')
export class TransportOrdersController {
  constructor(private readonly orders: TransportOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: OrderListQueryDto) {
    return this.orders.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTransportOrderDto) {
    return this.orders.create(user.tenantId, user.id, dto);
  }

  /**
   * Fulfillment bridge: "Prepare shipment" from a CONFIRMED CRM sales order.
   * Requires BOTH transportation.orders.manage AND crm.read (the customer is
   * read from the sales order). CRM module activation is re-checked in the
   * service. Idempotent on (salesOrder, fulfillmentKey).
   */
  @Post('from-sales-order/:salesOrderId')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE, PERMISSIONS.CRM.READ)
  createFromSalesOrder(
    @CurrentUser() user: AuthUser,
    @Param('salesOrderId') salesOrderId: string,
    @Body() dto: CreateTransportOrderFromSalesOrderDto,
  ) {
    return this.orders.createFromSalesOrder(user.tenantId, user.id, salesOrderId, dto);
  }

  /**
   * Read-only fulfillment context for a sales order: linked customer, transport
   * orders already derived from it, derived fulfillment status, and the
   * logistics fields a shipment still needs. Powers the "Prepare shipment" UI.
   */
  @Get('from-sales-order/:salesOrderId/context')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_READ, PERMISSIONS.CRM.READ)
  fulfillmentContext(@CurrentUser() user: AuthUser, @Param('salesOrderId') salesOrderId: string) {
    return this.orders.getSalesOrderFulfillmentContext(user.tenantId, salesOrderId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTransportOrderDto) {
    return this.orders.update(user.tenantId, id, dto);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.confirm(user.tenantId, user.id, id);
  }

  @Post(':id/plan')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  plan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PlanTransportOrderDto) {
    return this.orders.plan(user.tenantId, user.id, id, dto);
  }

  /** Appends an additional shipment to a PLANNED order (post-planning re-split). */
  @Post(':id/shipments')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  addShipment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShipmentSplitDto) {
    return this.orders.addShipment(user.tenantId, user.id, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(user.tenantId, user.id, id);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.close(user.tenantId, user.id, id);
  }
}
