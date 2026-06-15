import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentsModule } from '../agents/agents.module';
import { AgentRunsService } from './agent-runs.service';
import { AgentWorkerService } from './agent-worker.service';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { OperationalTasksService } from './operational-tasks.service';
import { OperationalTasksController } from './operational-tasks.controller';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [OperationalTasksController],
  providers: [
    DomainEventsService,
    TaskAssignmentResolver,
    OperationalTasksService,
    AgentRunsService,
    AgentWorkerService,
  ],
  exports: [DomainEventsService, OperationalTasksService, AgentWorkerService, AgentRunsService],
})
export class OperatingModule {}
