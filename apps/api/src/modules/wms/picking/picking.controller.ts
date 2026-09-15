import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AddPickLineDto, CreatePickOrderDto, PickListQueryDto } from './dto/pick.dto';
import { PickingService } from './picking.service';
import { WmsVersionDto } from '../document-operations';

@ApiTags('wms/picking')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/pick-orders')
export class PickingController {
  constructor(private readonly picking: PickingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: PickListQueryDto) {
    return this.picking.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.picking.get(user.tenantId, id);
  }

  @Post()
  @Audit('wms-pick-order', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePickOrderDto) {
    return this.picking.create(user.tenantId, user.id, dto);
  }

  @Post(':id/lines')
  @Audit('wms-pick-line', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  addLine(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddPickLineDto) {
    return this.picking.addLine(user.tenantId, id, dto);
  }

  @Patch(':id/lines/:lineId')
  @Audit('wms-pick-line', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: AddPickLineDto,
  ) {
    return this.picking.updateLine(user.tenantId, id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @Audit('wms-pick-line', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Query() q: WmsVersionDto,
  ) {
    return this.picking.removeLine(user.tenantId, id, lineId, q.expectedUpdatedAt);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WmsVersionDto) {
    return this.picking.complete(user.tenantId, user.id, id, dto?.expectedUpdatedAt);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WmsVersionDto) {
    return this.picking.cancel(user.tenantId, user.id, id, dto?.expectedUpdatedAt);
  }
}
