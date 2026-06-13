import { Controller, Get, Param, Post, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProposedActionsService } from './proposed-actions.service';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';

@ApiTags('core/agent-actions')
@ApiBearerAuth()
@Controller('agent-actions')
export class ProposedActionsController {
  constructor(
    private readonly proposals: ProposedActionsService,
    @Inject(AGENT_TOOL_SERVICES) private readonly toolServices: ToolServices,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_READ)
  listPending(@CurrentUser() user: AuthUser) {
    return this.proposals.listPending(user.tenantId);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.proposals.approve(user.tenantId, id, user.id, this.toolServices);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.proposals.reject(user.tenantId, id, user.id);
  }
}
