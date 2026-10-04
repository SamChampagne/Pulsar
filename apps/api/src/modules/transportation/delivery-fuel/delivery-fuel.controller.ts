import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { DeliveryFuelService } from './delivery-fuel.service';
import {
  FuelHistoryQueryDto,
  SaveFuelActualDto,
  SaveFuelPriceDto,
  SaveFuelProfileDto,
} from './delivery-fuel.dto';

@ApiTags('transportation/delivery-fuel')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/delivery-fuel')
export class DeliveryFuelController {
  constructor(private readonly fuel: DeliveryFuelService) {}
  @Get('loads/:id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  context(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fuel.context(u.tenantId, id);
  }
  @Get('vehicles/:id/profile')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  profiles(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: FuelHistoryQueryDto) {
    return this.fuel.profiles(u.tenantId, id, q.page);
  }
  @Post('vehicles/:id/profile')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  profile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SaveFuelProfileDto) {
    return this.fuel.saveProfile(u.tenantId, u.id, id, dto);
  }
  @Get('prices')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  prices(@CurrentUser() u: AuthUser, @Query() q: FuelHistoryQueryDto) {
    return this.fuel.prices(u.tenantId, q.page);
  }
  @Post('prices')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  price(@CurrentUser() u: AuthUser, @Body() dto: SaveFuelPriceDto) {
    return this.fuel.savePrice(u.tenantId, u.id, dto);
  }
  @Get('loads/:id/actuals')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  actuals(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: FuelHistoryQueryDto) {
    return this.fuel.actuals(u.tenantId, id, q.page);
  }
  @Post('loads/:id/actuals')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  actual(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SaveFuelActualDto) {
    return this.fuel.saveActual(u.tenantId, u.id, id, dto);
  }
}
