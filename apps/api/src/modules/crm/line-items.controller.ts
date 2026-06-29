import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LineItemsService } from './line-items.service';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/deals/:dealId/line-items')
export class LineItemsController {
  constructor(private readonly service: LineItemsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) {
    return this.service.list(user.tenantId, dealId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(
    @CurrentUser() user: AuthUser,
    @Param('dealId') dealId: string,
    @Body() dto: CreateLineItemDto,
  ) {
    return this.service.create(user.tenantId, user.id, dealId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('dealId') dealId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLineItemDto,
  ) {
    return this.service.update(user.tenantId, user.id, dealId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('dealId') dealId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(user.tenantId, user.id, dealId, id);
  }
}
