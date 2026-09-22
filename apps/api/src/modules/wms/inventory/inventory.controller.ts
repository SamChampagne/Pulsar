import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  AdjustStockDto,
  InventoryListQueryDto,
  MoveStockDto,
  MovementListQueryDto,
} from './dto/inventory.dto';
import { MovementHistoryService } from './movement-history.service';
import { InventoryService } from './inventory.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';

@ApiTags('wms/inventory')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly history: MovementHistoryService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  @Get('movements')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  async movements(@CurrentUser() user: AuthUser, @Query() query: MovementListQueryDto) {
    const services =
      user.permissions.includes(PERMISSIONS.SERVICES.READ) &&
      (await this.modules.getEnabledKeys(user.tenantId)).has(MODULE_KEYS.SERVICES);
    return this.history.list(user.tenantId, query, services);
  }

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
