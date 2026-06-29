import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ThreadsService } from './threads.service';
import { LinkThreadDto, ReplyThreadDto, ThreadListQueryDto } from './dto/thread.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/threads')
export class ThreadsController {
  constructor(private readonly service: ThreadsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ThreadListQueryDto) {
    return this.service.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post(':id/reply')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyThreadDto) {
    return this.service.reply(user.tenantId, id, dto, { userId: user.id });
  }

  @Post(':id/link')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  link(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: LinkThreadDto) {
    return this.service.link(user.tenantId, id, dto, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archive(user.tenantId, id, user.id);
  }
}
