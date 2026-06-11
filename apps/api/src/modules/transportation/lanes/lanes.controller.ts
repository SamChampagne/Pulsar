import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateLaneDto, SetLaneCarriersDto, UpdateLaneDto } from './dto/lane.dto';
import { LanesService } from './lanes.service';

@ApiTags('transportation/lanes')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/lanes')
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.lanes.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lanes.get(user.tenantId, id);
  }

  @Post()
  @Audit('lane', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLaneDto) {
    return this.lanes.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('lane', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLaneDto) {
    return this.lanes.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('lane', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lanes.remove(user.tenantId, id);
  }

  @Put(':id/carriers')
  @Audit('lane', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  setCarriers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetLaneCarriersDto) {
    return this.lanes.setCarriers(user.tenantId, id, dto.carrierIds);
  }
}
