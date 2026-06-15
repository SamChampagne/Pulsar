import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OperationalTasksService } from './operational-tasks.service';
import { ListTasksDto } from './dto/list-tasks.dto';
import { AssignTaskDto, ResolveTaskDto } from './dto/task-action.dto';

@ApiTags('core/operating')
@ApiBearerAuth()
@Controller('operational-tasks')
export class OperationalTasksController {
  constructor(private readonly tasks: OperationalTasksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListTasksDto) {
    return this.tasks.list(user.tenantId, {
      status: query.status,
      category: query.category,
      assigneeType: query.assigneeType,
      type: undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user.tenantId, id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AssignTaskDto) {
    return this.tasks.assign(user.tenantId, id, user.id, body);
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ResolveTaskDto) {
    return this.tasks.resolve(user.tenantId, id, user.id, body.note);
  }

  @Post(':id/dismiss')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ResolveTaskDto) {
    return this.tasks.dismiss(user.tenantId, id, user.id, body.note);
  }
}
