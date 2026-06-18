import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { DocumentsModule } from '../../core/documents/documents.module';
import { BillingModule } from '../billing/billing.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { PortalAdminController, PortalLinksController, PortalPublicController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [AuditLogsModule, DocumentsModule, BillingModule, OperatingModule],
  controllers: [PortalLinksController, PortalPublicController, PortalAdminController],
  providers: [PortalService],
})
export class CustomerPortalModule {}
