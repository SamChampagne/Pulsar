import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { VehiclesService } from './vehicles.service';

@ApiTags('transportation/vehicles')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.vehicles.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicles.get(user.tenantId, id);
  }

  @Post()
  @Audit('vehicle', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('vehicle', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(user.tenantId, id, dto);
  }
}
