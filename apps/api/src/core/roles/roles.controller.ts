import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateRoleDto, CreateRoleFromTemplateDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('core/roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('templates')
  @RequirePermissions(PERMISSIONS.CORE.ROLES_READ)
  templates(@CurrentUser() user: AuthUser) {
    return this.roles.templates(user.tenantId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.ROLES_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.ROLES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.get(user.tenantId, id);
  }

  @Post()
  @Audit('role', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.CORE.ROLES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.tenantId, dto);
  }

  @Post('from-template')
  @Audit('role', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.CORE.ROLES_MANAGE)
  createFromTemplate(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleFromTemplateDto) {
    return this.roles.createFromTemplate(user.tenantId, dto.templateKey);
  }

  @Patch(':id')
  @Audit('role', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.ROLES_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.ROLES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.remove(user.tenantId, id, user.id);
  }
}
