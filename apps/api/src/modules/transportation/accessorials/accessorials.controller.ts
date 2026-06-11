import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { AccessorialsService } from './accessorials.service';
import { CreateAccessorialDto, UpdateAccessorialDto } from './dto/accessorial.dto';

@ApiTags('transportation/accessorials')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/accessorials')
export class AccessorialsController {
  constructor(private readonly accessorials: AccessorialsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.accessorials.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accessorials.get(user.tenantId, id);
  }

  @Post()
  @Audit('accessorial', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccessorialDto) {
    return this.accessorials.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('accessorial', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAccessorialDto) {
    return this.accessorials.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('accessorial', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accessorials.remove(user.tenantId, id);
  }
}
