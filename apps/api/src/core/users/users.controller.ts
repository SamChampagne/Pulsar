import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('core/users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.USERS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.users.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.USERS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.get(user.tenantId, id);
  }

  @Post()
  @Audit('user', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('user', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user.tenantId, id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(user.tenantId, id, user.id);
  }

  @Post(':id/resend-invitation')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  resendInvitation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.resendInvitation(user.tenantId, id, user.id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.reactivate(user.tenantId, id, user.id);
  }
}
