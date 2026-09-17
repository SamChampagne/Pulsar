import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateManufacturingOrderDto,
  CreateOperationDto,
  FromRoutingDto,
  ManufacturingOrderListQueryDto,
  UpdateManufacturingOrderDto,
  UpdateOperationDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';
import { MaterialContextDto } from './dto/material-context.dto';

@ApiTags('manufacturing/orders')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ManufacturingOrderListQueryDto) {
    return this.orders.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user.tenantId, id);
  }

  @Post()
  @Audit('manufacturing-order', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateManufacturingOrderDto) {
    return this.orders.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @Audit('manufacturing-order', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateManufacturingOrderDto,
  ) {
    return this.orders.update(user.tenantId, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.remove(user.tenantId, id);
  }

  // --- Lifecycle -----------------------------------------------------------

  @Post(':id/material-context')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE, PERMISSIONS.WMS.READ)
  materials(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MaterialContextDto,
  ) {
    return this.orders.setMaterialContext(user.tenantId, user.id, id, dto);
  }

  @Post(':id/release')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.release(user.tenantId, user.id, id);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.start(user.tenantId, user.id, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.complete(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(user.tenantId, user.id, id);
  }

  // --- Operations sub-resource --------------------------------------------

  @Post(':id/operations')
  @Audit('manufacturing-operation', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  addOperation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateOperationDto,
  ) {
    return this.orders.addOperation(user.tenantId, user.id, id, dto);
  }

  @Patch(':id/operations/:opId')
  @Audit('manufacturing-operation', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  updateOperation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('opId') opId: string,
    @Body() dto: UpdateOperationDto,
  ) {
    return this.orders.updateOperation(user.tenantId, id, opId, dto);
  }

  @Delete(':id/operations/:opId')
  @Audit('manufacturing-operation', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  removeOperation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('opId') opId: string,
  ) {
    return this.orders.removeOperation(user.tenantId, id, opId);
  }

  @Post(':id/operations/from-routing')
  @Audit('manufacturing-order', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  operationsFromRouting(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: FromRoutingDto,
  ) {
    return this.orders.operationsFromRouting(user.tenantId, user.id, id, dto.routingId);
  }
}
