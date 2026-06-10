import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, ShipmentStatus } from '@pulsar/shared';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { ShipmentsService } from './shipments.service';

class ShipmentListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;
}

class AssignLoadDto {
  @IsString()
  loadId!: string;
}

@ApiTags('transportation/shipments')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ShipmentListQueryDto) {
    return this.shipments.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.get(user.tenantId, id);
  }

  @Post(':id/assign-load')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  assignToLoad(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignLoadDto) {
    return this.shipments.assignToLoad(user.tenantId, id, dto.loadId);
  }

  @Post(':id/remove-load')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  removeFromLoad(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.removeFromLoad(user.tenantId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.cancel(user.tenantId, id);
  }

  /** Public tracking link management (share with the end customer). */
  @Post(':id/share')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE)
  share(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.generateTrackingLink(user.tenantId, id);
  }

  @Delete(':id/share')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE)
  revokeShare(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.revokeTrackingLink(user.tenantId, id);
  }
}
