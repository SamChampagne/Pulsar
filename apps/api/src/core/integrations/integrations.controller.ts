import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IntegrationsService } from './integrations.service';

class CreateIntegrationDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(['DISABLED', 'ENABLED', 'ERROR'])
  status?: 'DISABLED' | 'ENABLED' | 'ERROR';

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['DISABLED', 'ENABLED', 'ERROR'])
  status?: 'DISABLED' | 'ENABLED' | 'ERROR';

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

class DryRunMappingDto {
  @IsString()
  source!: string;

  @IsString()
  target!: string;

  @IsOptional()
  @IsString()
  transform?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

class DryRunIntegrationDto {
  @IsOptional()
  @IsString()
  samplePayload?: string;

  @IsOptional()
  @IsArray()
  mappings?: DryRunMappingDto[];
}

@ApiTags('core/integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.integrations.list(user.tenantId);
  }

  /**
   * Catalog of the business events an integration can subscribe to
   * (`config.events[]`) — type, module, FR description, example payload.
   * Static data: no tenant scope needed beyond the permission check.
   */
  @Get('events')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_READ)
  events() {
    return this.integrations.eventCatalog();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIntegrationDto) {
    return this.integrations.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrations.update(user.tenantId, id, dto);
  }

  @Post(':id/test')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  testConnection(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.testConnection(user.tenantId, id, user.id);
  }

  @Post(':id/dry-run')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  dryRun(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DryRunIntegrationDto) {
    return this.integrations.dryRun(user.tenantId, id, dto);
  }

  /** Re-queue and retry one delivery (tenant-scoped; 404 when unknown). */
  @Post(':id/deliveries/:deliveryId/replay')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_MANAGE)
  replayDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.integrations.replayDelivery(user.tenantId, id, deliveryId, user.id);
  }

  /** Recent webhook deliveries of an integration (outbox audit/debugging). */
  @Get(':id/deliveries')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_READ)
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.listDeliveries(user.tenantId, id);
  }
}
