import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateLocationDto,
  LocationsListQueryDto,
  UpdateLocationDto,
} from '../../../core/locations/dto/location.dto';
import { LocationsService } from '../../../core/locations/locations.service';

/** Backward-compatible alias of core `/locations`, gated by the TMS module. New code uses `/locations`. */
@ApiTags('transportation/locations')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: LocationsListQueryDto) {
    return this.locations.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.locations.get(user.tenantId, id);
  }

  @Post()
  @Audit('location', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('location', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(user.tenantId, id, dto);
  }
}
