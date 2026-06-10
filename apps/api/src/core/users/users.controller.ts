import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
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
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(user.tenantId, id);
  }
}
