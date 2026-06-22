import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { PipelineController } from './pipeline.controller';

/**
 * CRM module (companies, contacts, deals, activities, pipeline).
 * Every controller is gated by @RequireModule(MODULE_KEYS.CRM).
 * PrismaService + OwnershipService + SequencesService come from the @Global() PrismaModule.
 * AuditLogsService comes from AuditLogsModule (same pattern as FleetModule).
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [
    CompaniesController,
    ContactsController,
    DealsController,
    ActivitiesController,
    PipelineController,
  ],
  providers: [CompaniesService, ContactsService, DealsService, ActivitiesService],
  exports: [CompaniesService, ContactsService, DealsService, ActivitiesService],
})
export class CrmModule {}
