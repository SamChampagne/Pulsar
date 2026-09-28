import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FixedAssetsService } from './fixed-assets.service';
import {
  ActivateAssetDto,
  CreateFixedAssetDto,
  DepreciateDto,
  RetireAssetDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';

@ApiTags('billing/fixed-assets')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/fixed-assets')
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.tenantId);
  }

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ)
  accounts(@CurrentUser() user: AuthUser) {
    return this.service.accounts(user.tenantId);
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ)
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.history(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ, PERMISSIONS.BILLING.ASSETS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFixedAssetDto) {
    return this.service.create(user, dto);
  }

  // Declare :id/schedule BEFORE :id to avoid routing conflicts
  @Get(':id/schedule')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ)
  schedule(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.schedule(
      user.tenantId,
      id,
      user.permissions.includes(PERMISSIONS.BILLING.LEDGER_READ),
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ, PERMISSIONS.BILLING.ASSETS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFixedAssetDto) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ, PERMISSIONS.BILLING.ASSETS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ, PERMISSIONS.BILLING.ASSETS_MANAGE)
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ActivateAssetDto) {
    return this.service.activate(user, id, dto);
  }

  @Post(':id/depreciate')
  @RequirePermissions(
    PERMISSIONS.BILLING.ASSETS_READ,
    PERMISSIONS.BILLING.ASSETS_MANAGE,
    PERMISSIONS.BILLING.ASSETS_POST,
  )
  depreciate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DepreciateDto) {
    return this.service.depreciate(user, id, dto);
  }

  @Post(':id/dispose')
  @RequirePermissions(PERMISSIONS.BILLING.ASSETS_READ, PERMISSIONS.BILLING.ASSETS_MANAGE)
  dispose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RetireAssetDto) {
    return this.service.dispose(user, id, dto);
  }
}
