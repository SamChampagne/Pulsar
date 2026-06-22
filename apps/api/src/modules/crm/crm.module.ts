import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

/**
 * CRM module (companies, contacts; deals + activities in Task 4).
 * Every controller is gated by @RequireModule(MODULE_KEYS.CRM).
 * PrismaService + OwnershipService come from the @Global() PrismaModule.
 * AuditLogsService comes from AuditLogsModule (same pattern as FleetModule).
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [CompaniesController, ContactsController],
  providers: [CompaniesService, ContactsService],
  exports: [CompaniesService, ContactsService],
})
export class CrmModule {}
