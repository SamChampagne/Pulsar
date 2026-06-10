import { Module } from '@nestjs/common';
import { PortalLinksController, PortalPublicController } from './portal.controller';
import { PortalService } from './portal.service';

/**
 * Customer Portal — second business module, activable per tenant.
 * v1 scope: capability-link visibility (orders + shipment statuses + tracking
 * links) for the shipper's customers. Order entry comes later.
 */
@Module({
  controllers: [PortalLinksController, PortalPublicController],
  providers: [PortalService],
})
export class CustomerPortalModule {}
