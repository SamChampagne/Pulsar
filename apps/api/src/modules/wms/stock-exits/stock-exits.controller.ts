import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { StockExitsService } from './stock-exits.service';
import { StockExitPurchasesService } from './stock-exit-purchases.service';
import {
  StockExitCreateDto,
  StockExitPostDto,
  StockExitCancelDto,
  StockExitQueryDto,
  StockExitSourcesDto,
  StockExitPurchaseSourcesDto,
} from './stock-exits.dto';
@ApiTags('wms/stock-exits')
@ApiBearerAuth()
@RequireModule('wms')
@Controller('wms/stock-exits')
export class StockExitsController {
  constructor(
    private readonly service: StockExitsService,
    private readonly purchases: StockExitPurchasesService,
  ) {}
  @Get('purchase-sources') @RequirePermissions('wms.read', 'purchasing.read') purchaseSources(
    @CurrentUser() u: AuthUser,
    @Query() q: StockExitPurchaseSourcesDto,
  ) {
    return this.purchases.sources(u, q);
  }
  @Get(':id/purchase') @RequirePermissions('wms.read') purchase(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.purchases.view(u, id);
  }
  @Get() @RequirePermissions('wms.read') list(
    @CurrentUser() u: AuthUser,
    @Query() q: StockExitQueryDto,
  ) {
    return this.service.list(u, q);
  }
  @Get('sources') @RequirePermissions('wms.read') sources(
    @CurrentUser() u: AuthUser,
    @Query() q: StockExitSourcesDto,
  ) {
    return this.service.sources(u.tenantId, q);
  }
  @Get(':id') @RequirePermissions('wms.read') get(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.get(u.tenantId, id);
  }
  @Get(':id/review') @RequirePermissions('wms.read') review(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.review(u, id);
  }
  @Post() @RequirePermissions('wms.read', 'wms.manage') create(
    @CurrentUser() u: AuthUser,
    @Body() d: StockExitCreateDto,
  ) {
    return this.service.create(u, d);
  }
  @Post(':id/post') @RequirePermissions('wms.read', 'wms.manage') post(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: StockExitPostDto,
  ) {
    return this.service.post(u, id, d);
  }
  @Post(':id/cancel') @RequirePermissions('wms.read', 'wms.manage') cancel(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: StockExitCancelDto,
  ) {
    return this.service.cancel(u, id, d);
  }
}
