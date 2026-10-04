import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateDeliveryAllocationDto,
  DeliveryAllocationQuery,
  ReleaseDeliveryAllocationDto,
} from './delivery-allocation.dto';
import { DeliveryAllocationService } from './delivery-allocation.service';

@ApiTags('transportation/delivery-allocation')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/delivery-allocation')
export class DeliveryAllocationController {
  constructor(private readonly allocations: DeliveryAllocationService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: DeliveryAllocationQuery) {
    return this.allocations.list(user, query.shipmentId);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeliveryAllocationDto) {
    return this.allocations.create(user, dto);
  }
  @Post(':id/release')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  release(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReleaseDeliveryAllocationDto,
  ) {
    return this.allocations.release(user, id, dto);
  }
}
