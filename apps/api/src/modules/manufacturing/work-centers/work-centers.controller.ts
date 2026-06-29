import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateWorkCenterDto, UpdateWorkCenterDto } from './dto/work-center.dto';
import { WorkCentersService } from './work-centers.service';

@ApiTags('manufacturing/work-centers')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/work-centers')
export class WorkCentersController {
  constructor(private readonly workCenters: WorkCentersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.workCenters.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workCenters.get(user.tenantId, id);
  }

  @Post()
  @Audit('work-center', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkCenterDto) {
    return this.workCenters.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('work-center', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWorkCenterDto) {
    return this.workCenters.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workCenters.remove(user.tenantId, id);
  }
}
