import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';
import { DocumentsModule } from '../../core/documents/documents.module';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
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
import { ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { LineItemsController } from './line-items.controller';
import { LineItemsService } from './line-items.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderLineItemsController } from './sales-order-line-items.controller';
import { SalesOrderLineItemsService } from './sales-order-line-items.service';

/**
 * CRM module (companies, contacts, deals, activities, pipeline, overview, lists, campaigns, threads).
 * Every controller is gated by @RequireModule(MODULE_KEYS.CRM).
 * PrismaService + OwnershipService + SequencesService come from the @Global() PrismaModule.
 * AuditLogsService comes from AuditLogsModule (same pattern as FleetModule).
 * OperatingModule is imported to expose DomainEventsService (needed by CrmExceptionsService).
 * CustomFieldsModule is imported to support crm/custom-fields and intake validation.
 * DocumentsModule is imported to allow ThreadsService to resolve presigned attachment URLs.
 * MailService comes from the @Global() EmailModule (no explicit import needed).
 */
@Module({
  imports: [AuditLogsModule, CustomFieldsModule, DocumentsModule, ModuleRegistryModule, OperatingModule],
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
    ThreadsController,
    ProductsController,
    LineItemsController,
    SalesOrdersController,
    SalesOrderLineItemsController,
  ],
  providers: [CompaniesService, ContactsService, DealsService, ActivitiesService, CrmExceptionsService, OverviewService, ListsService, CampaignsService, ThreadsService, ProductsService, LineItemsService, SalesOrdersService, SalesOrderLineItemsService],
  exports: [CompaniesService, ContactsService, DealsService, ActivitiesService, OverviewService, ListsService, CampaignsService, ThreadsService, ProductsService, LineItemsService, SalesOrdersService, SalesOrderLineItemsService],
})
export class CrmModule {}
