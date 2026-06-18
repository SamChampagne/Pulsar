import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { DocumentsModule } from '../../core/documents/documents.module';
import { TransportationModule } from '../transportation/transportation.module';
import { CarrierPortalAdminController } from './carrier-portal.admin.controller';
import { CarrierPortalPublicController } from './carrier-portal.public.controller';
import { CarrierPortalService } from './carrier-portal.service';

/**
 * Carrier Portal — activable per-tenant business module.
 * Provides admin link mint/revoke and a public token-authenticated portal
 * where carriers can view their tenders, loads, and incoming invoices.
 *
 * PrismaModule and TenantModulesCacheService are global (no explicit import needed).
 * TendersService is re-used from TransportationModule (already exported there).
 */
@Module({
  imports: [AuditLogsModule, DocumentsModule, TransportationModule],
  controllers: [CarrierPortalAdminController, CarrierPortalPublicController],
  providers: [CarrierPortalService],
})
export class CarrierPortalModule {}
