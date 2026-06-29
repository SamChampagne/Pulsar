import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import {
  CreateRoutingDto,
  CreateRoutingStepDto,
  UpdateRoutingDto,
  UpdateRoutingStepDto,
} from './dto/routing.dto';
import { RoutingsService } from './routings.service';

@ApiTags('manufacturing/routings')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/routings')
export class RoutingsController {
  constructor(private readonly routings: RoutingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.routings.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routings.get(user.tenantId, id);
  }

  @Post()
  @Audit('routing', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoutingDto) {
    return this.routings.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('routing', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoutingDto) {
    return this.routings.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routings.remove(user.tenantId, id);
  }

  @Post(':id/steps')
  @Audit('routing-step', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  addStep(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateRoutingStepDto,
  ) {
    return this.routings.addStep(user.tenantId, id, dto);
  }

  @Patch(':id/steps/:stepId')
  @Audit('routing-step', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  updateStep(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateRoutingStepDto,
  ) {
    return this.routings.updateStep(user.tenantId, id, stepId, dto);
  }

  @Delete(':id/steps/:stepId')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  removeStep(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.routings.removeStep(user.tenantId, id, stepId);
  }
}
