import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AdjustStockDto, InventoryListQueryDto, MoveStockDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('wms/inventory')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: InventoryListQueryDto) {
    return this.inventory.list(user.tenantId, query);
  }

  @Post('move')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  move(@CurrentUser() user: AuthUser, @Body() dto: MoveStockDto) {
    return this.inventory.move(user.tenantId, user.id, dto);
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustStockDto) {
    return this.inventory.adjust(user.tenantId, user.id, dto);
  }
}
