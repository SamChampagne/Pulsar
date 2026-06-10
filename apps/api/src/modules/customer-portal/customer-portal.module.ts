import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { PortalLinksController, PortalPublicController } from './portal.controller';
import { PortalService } from './portal.service';

/**
 * Customer Portal — second business module, activable per tenant.
 * v1 scope: capability-link visibility (orders + shipment statuses + tracking
 * links) for the shipper's customers. Order entry comes later.
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [PortalLinksController, PortalPublicController],
  providers: [PortalService],
})
export class CustomerPortalModule {}
