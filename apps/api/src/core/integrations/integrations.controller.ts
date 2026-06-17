import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
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

  /** Recent webhook deliveries of an integration (outbox audit/debugging). */
  @Get(':id/deliveries')
  @RequirePermissions(PERMISSIONS.CORE.INTEGRATIONS_READ)
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.listDeliveries(user.tenantId, id);
  }
}
