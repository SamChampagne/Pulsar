import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, PERMISSIONS } from '@pulsar/shared';
import { IsBoolean, IsObject } from 'class-validator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModuleRegistryService } from './module-registry.service';
import { ModuleSettingsService } from './module-settings.service';

class ToggleModuleDto {
  @IsBoolean()
  enabled!: boolean;
}

class SettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}

@ApiTags('core/modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleRegistryController {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly settings: ModuleSettingsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.registry.listForTenant(user.tenantId);
  }

  @Patch(':key')
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  toggle(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: ToggleModuleDto) {
    return this.registry.setEnabled(user.tenantId, key, dto.enabled);
  }

  @Get(':key/settings')
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  async getSettings(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return {
      descriptors: this.settings.descriptors(key),
      values: await this.settings.resolve(user.tenantId, key),
    };
  }

  @Put(':key/settings')
  @Audit('tenant-module', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  async putSettings(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SettingsDto) {
    return { values: await this.settings.update(user.tenantId, key, dto.settings) };
  }
}
