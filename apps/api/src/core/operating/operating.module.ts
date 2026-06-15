import { Module } from '@nestjs/common';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';

@Module({
  providers: [DomainEventsService, TaskAssignmentResolver],
  exports: [DomainEventsService],
})
export class OperatingModule {}
