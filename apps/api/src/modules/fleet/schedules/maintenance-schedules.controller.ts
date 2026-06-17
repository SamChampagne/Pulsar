import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateMaintenanceScheduleDto,
  ScheduleListQueryDto,
  UpdateMaintenanceScheduleDto,
} from './dto/schedule.dto';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';

@ApiTags('fleet/maintenance-schedules')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.FLEET)
@Controller('fleet/maintenance-schedules')
export class MaintenanceSchedulesController {
  constructor(private readonly schedules: MaintenanceSchedulesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ScheduleListQueryDto) {
    return this.schedules.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMaintenanceScheduleDto) {
    return this.schedules.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceScheduleDto,
  ) {
    return this.schedules.update(user.tenantId, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.remove(user.tenantId, user.id, id);
  }

  @Post(':id/generate-order')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  generateOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.generateOrder(user.tenantId, user.id, id);
  }
}
