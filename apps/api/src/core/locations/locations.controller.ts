import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateLocationDto, LocationsListQueryDto, UpdateLocationDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags('core/locations')
@ApiBearerAuth()
@Controller('locations')
export class CoreLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.LOCATIONS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: LocationsListQueryDto) {
    return this.locations.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.LOCATIONS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.locations.get(user.tenantId, id);
  }

  @Post()
  @Audit('location', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.CORE.LOCATIONS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('location', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.LOCATIONS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(user.tenantId, id, dto);
  }
}
