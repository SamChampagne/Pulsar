import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { OperationalTasksService } from './operational-tasks.service';

@Module({
  imports: [AuditLogsModule],
  providers: [DomainEventsService, TaskAssignmentResolver, OperationalTasksService],
  exports: [DomainEventsService, OperationalTasksService],
})
export class OperatingModule {}
