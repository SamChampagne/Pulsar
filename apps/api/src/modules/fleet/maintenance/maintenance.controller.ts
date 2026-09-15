import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CompleteMaintenanceOrderDto,
  CreateMaintenanceOrderDto,
  MaintenanceListQueryDto,
  MaintenanceVersionDto,
  UpdateMaintenanceOrderDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('fleet/maintenance')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.FLEET)
@Controller('fleet/maintenance-orders')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: MaintenanceListQueryDto) {
    return this.maintenance.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.maintenance.get(user.tenantId, id);
  }

  @Post()
  @Audit('maintenance-order', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMaintenanceOrderDto) {
    return this.maintenance.create(user.tenantId, user.id, dto);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  start(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MaintenanceVersionDto,
  ) {
    return this.maintenance.start(user.tenantId, user.id, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CompleteMaintenanceOrderDto,
  ) {
    return this.maintenance.complete(user.tenantId, user.id, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MaintenanceVersionDto,
  ) {
    return this.maintenance.cancel(user.tenantId, user.id, id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceOrderDto,
  ) {
    return this.maintenance.update(user.tenantId, user.id, id, dto);
  }
}
