import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ShopFloorService } from './shop-floor.service';
import { ProductionDeclarationDto } from './shop-floor.dto';

@Controller('manufacturing/shop-floor')
@RequireModule(MODULE_KEYS.MANUFACTURING)
export class ShopFloorController {
  constructor(private readonly service: ShopFloorService) {}
  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(u.tenantId, id);
  }
  @Post('orders/:id/declarations')
  @RequirePermissions(
    PERMISSIONS.MANUFACTURING.READ,
    PERMISSIONS.MANUFACTURING.MANAGE,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.WMS.MANAGE,
  )
  declare(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ProductionDeclarationDto,
  ) {
    return this.service.declare(u.tenantId, u.id, id, dto);
  }
}
