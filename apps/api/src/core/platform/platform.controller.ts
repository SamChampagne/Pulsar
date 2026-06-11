import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantStatus, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { CreateTenantDto, ToggleModuleDto, UpdateTenantDto } from './dto/platform.dto';
import { PlatformService } from './platform.service';

/**
 * Cross-tenant administration plane (create/suspend/configure tenants).
 * Class-level @PlatformAdmin() gates every route to platform staff; routes are
 * intentionally not module-gated and never read the caller's tenantId.
 */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('tenants')
  listTenants(@Query() query: ListQueryDto) {
    return this.platform.listTenants(query);
  }

  @Post('tenants')
  createTenant(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.platform.createTenant(dto, user.id);
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.platform.getTenant(id);
  }

  @Patch('tenants/:id')
  rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.platform.rename(id, dto, user.id);
  }

  @Post('tenants/:id/suspend')
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.setStatus(id, TenantStatus.SUSPENDED, user.id);
  }

  @Post('tenants/:id/activate')
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.setStatus(id, TenantStatus.ACTIVE, user.id);
  }

  @Patch('tenants/:id/modules/:key')
  setModule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: ToggleModuleDto,
  ) {
    return this.platform.setModule(id, key, dto.enabled, user.id);
  }
}
