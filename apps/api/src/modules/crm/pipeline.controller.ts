import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DealsService } from './deals.service';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/pipeline')
export class PipelineController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  pipeline(@CurrentUser() user: AuthUser, @Query('pipelineId') pipelineId?: string) {
    return this.deals.pipeline(user.tenantId, pipelineId);
  }
}
