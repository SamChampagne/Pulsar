import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentsModule } from '../agents/agents.module';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { OperationalTasksService } from './operational-tasks.service';
import { OperationalTasksController } from './operational-tasks.controller';
import { WorkbenchAgentRunner } from './workbench-agent-runner.service';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [OperationalTasksController],
  providers: [DomainEventsService, TaskAssignmentResolver, OperationalTasksService, WorkbenchAgentRunner],
  exports: [DomainEventsService, OperationalTasksService],
})
export class OperatingModule {}
