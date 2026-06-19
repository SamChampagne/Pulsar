import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AutomationRulesService } from './automation-rules.service';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from './dto/automation-rule.dto';

@ApiTags('core/automation')
@ApiBearerAuth()
@Controller('automation/rules')
export class AutomationRulesController {
  constructor(private readonly rules: AutomationRulesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AUTOMATION_RULES_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.rules.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.AUTOMATION_RULES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rules.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AUTOMATION_RULES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateAutomationRuleDto) {
    return this.rules.create(user.tenantId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CORE.AUTOMATION_RULES_MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateAutomationRuleDto,
  ) {
    return this.rules.update(user.tenantId, id, user.id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.AUTOMATION_RULES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rules.remove(user.tenantId, id, user.id);
  }
}
