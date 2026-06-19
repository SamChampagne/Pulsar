import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { CustomRuleResolver } from './custom-rule.resolver';

@Module({
  imports: [AuditLogsModule],
  controllers: [AutomationRulesController],
  providers: [AutomationRulesService, CustomRuleResolver],
  exports: [CustomRuleResolver],
})
export class AutomationModule {}
