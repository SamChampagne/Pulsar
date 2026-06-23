import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { CrmCustomFieldsController } from './custom-fields/crm-custom-fields.controller';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { PipelineController } from './pipeline.controller';
import { CrmExceptionsService } from './crm-exceptions.service';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * CRM module (companies, contacts, deals, activities, pipeline, overview, lists, campaigns).
 * Every controller is gated by @RequireModule(MODULE_KEYS.CRM).
 * PrismaService + OwnershipService + SequencesService come from the @Global() PrismaModule.
 * AuditLogsService comes from AuditLogsModule (same pattern as FleetModule).
 * OperatingModule is imported to expose DomainEventsService (needed by CrmExceptionsService).
 * CustomFieldsModule is imported to support crm/custom-fields and intake validation.
 * MailService comes from the @Global() EmailModule (no explicit import needed).
 */
@Module({
  imports: [AuditLogsModule, CustomFieldsModule, OperatingModule],
  controllers: [
    CrmCustomFieldsController,
    CompaniesController,
    ContactsController,
    DealsController,
    ActivitiesController,
    PipelineController,
    OverviewController,
    ListsController,
    CampaignsController,
  ],
  providers: [CompaniesService, ContactsService, DealsService, ActivitiesService, CrmExceptionsService, OverviewService, ListsService, CampaignsService],
  exports: [CompaniesService, ContactsService, DealsService, ActivitiesService, OverviewService, ListsService, CampaignsService],
})
export class CrmModule {}
