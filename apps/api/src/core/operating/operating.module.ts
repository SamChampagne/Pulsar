import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentsModule } from '../agents/agents.module';
import { AutomationModule } from '../automation/automation.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AgentRunsService } from './agent-runs.service';
import { AgentWorkerService } from './agent-worker.service';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { OperationalTasksService } from './operational-tasks.service';
import { OperationalTasksController } from './operational-tasks.controller';
import { SlaEscalationService } from './sla-escalation.service';

@Module({
  imports: [
    AuditLogsModule,
    NotificationsModule,
    AutomationModule,
    // Rule 55: the domain-event outbox bridges to the outbound webhook outbox.
    // IntegrationsModule only depends on CryptoModule, so no cycle here.
    IntegrationsModule,
    forwardRef(() => AgentsModule),
  ],
  controllers: [OperationalTasksController],
  providers: [
    DomainEventsService,
    TaskAssignmentResolver,
    OperationalTasksService,
    AgentRunsService,
    AgentWorkerService,
    SlaEscalationService,
  ],
  exports: [DomainEventsService, OperationalTasksService, AgentWorkerService, AgentRunsService],
})
export class OperatingModule {}
