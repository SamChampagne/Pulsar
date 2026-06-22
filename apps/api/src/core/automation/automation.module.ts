import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { CustomRuleResolver } from './custom-rule.resolver';
import { ReactionExecutorService } from './reaction-executor.service';

/**
 * AutomationModule provides CustomRuleResolver (consumed by OperatingModule's
 * DomainEventsService) and ReactionExecutorService (consumed by processPending).
 *
 * DI cycle management: OperatingModule → AutomationModule → WmsModule/BillingModule
 * was a circular JavaScript require that crashed NestJS test compilation.
 * ReactionExecutorService now uses ModuleRef.get() with lazy require() to resolve
 * PickingService / CustomerInvoicesService at call-time, breaking the cycle entirely.
 * No forwardRef imports of WmsModule or BillingModule needed here.
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [AutomationRulesController],
  providers: [AutomationRulesService, CustomRuleResolver, ReactionExecutorService],
  exports: [CustomRuleResolver, ReactionExecutorService],
})
export class AutomationModule {}
