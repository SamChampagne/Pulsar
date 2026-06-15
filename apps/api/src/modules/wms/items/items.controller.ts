import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import { ItemsService } from './items.service';

@ApiTags('wms/items')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.items.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.get(user.tenantId, id);
  }

  @Post()
  @Audit('wms-item', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto) {
    return this.items.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @Audit('wms-item', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(user.tenantId, id, dto);
  }
}
