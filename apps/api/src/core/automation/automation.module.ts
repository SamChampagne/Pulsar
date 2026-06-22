import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { CustomRuleResolver } from './custom-rule.resolver';
import { ReactionExecutorService } from './reaction-executor.service';
import { WmsModule } from '../../modules/wms/wms.module';
import { BillingModule } from '../../modules/billing/billing.module';

/**
 * AutomationModule provides CustomRuleResolver (consumed by OperatingModule's
 * DomainEventsService) and ReactionExecutorService (consumed by Task 5's
 * processPending wiring).
 *
 * DI cycle management: OperatingModule → AutomationModule → WmsModule/BillingModule
 * → OperatingModule. WmsModule and BillingModule already guard their side with
 * forwardRef(() => OperatingModule); we mirror with forwardRef here so Nest can
 * resolve the circular graph at boot.
 */
@Module({
  imports: [
    AuditLogsModule,
    forwardRef(() => WmsModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [AutomationRulesController],
  providers: [AutomationRulesService, CustomRuleResolver, ReactionExecutorService],
  exports: [CustomRuleResolver, ReactionExecutorService],
})
export class AutomationModule {}
