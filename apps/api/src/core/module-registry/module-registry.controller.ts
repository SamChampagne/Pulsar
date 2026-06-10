import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModuleRegistryService } from './module-registry.service';

class ToggleModuleDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('core/modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleRegistryController {
  constructor(private readonly registry: ModuleRegistryService) {}

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
}
