import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateFuelTableDto, UpdateFuelTableDto } from './dto/fuel-table.dto';
import { FuelTablesService } from './fuel-tables.service';

@ApiTags('transportation/fuel-tables')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/fuel-tables')
export class FuelTablesController {
  constructor(private readonly fuelTables: FuelTablesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.fuelTables.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelTables.get(user.tenantId, id);
  }

  @Post()
  @Audit('fuel-table', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFuelTableDto) {
    return this.fuelTables.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('fuel-table', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFuelTableDto) {
    return this.fuelTables.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('fuel-table', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelTables.remove(user.tenantId, id);
  }
}
