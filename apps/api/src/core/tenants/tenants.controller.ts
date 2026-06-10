import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantsService } from './tenants.service';

class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

@ApiTags('core/tenants')
@ApiBearerAuth()
@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** The tenant of the authenticated user. Cross-tenant administration is a platform concern (phase 3). */
  @Get()
  @RequirePermissions(PERMISSIONS.CORE.TENANT_READ)
  current(@CurrentUser() user: AuthUser) {
    return this.tenants.getById(user.tenantId);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateTenantDto) {
    return this.tenants.updateSettings(user.tenantId, dto);
  }
}
