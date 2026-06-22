import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActivitiesService } from './activities.service';
import { ActivityListQueryDto, CreateActivityDto } from './dto/activity.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ActivityListQueryDto) {
    return this.activities.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.activities.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto) {
    return this.activities.create(user.tenantId, dto, { userId: user.id });
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.activities.complete(user.tenantId, id);
  }
}
