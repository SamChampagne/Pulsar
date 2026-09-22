import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { BusinessService } from './business.service';
import { ServicesCommerceService } from './services-commerce.service';
import { ServicesCommerceController, PartnerLinksController } from './services-commerce.controller';
import { ServicesPlanningService } from './services-planning.service';
import { ServicesPlanningController } from './services-planning.controller';
import { ServicesAvailabilityService } from './services-availability.service';
import { ServicesTimeService } from './services-time.service';
import { ServicesPartsService } from './services-parts.service';
import { SupplierReceiptsService } from './supplier-receipts.service';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { InventoryService } from '../wms/inventory/inventory.service';
import {
  CatalogController,
  ServicesController,
  PurchasingController,
} from './business.controllers';
@Module({
  imports: [AuditLogsModule],
  providers: [
    ServicesCommerceService,
    ServicesPlanningService,
    BusinessService,
    ServicesAvailabilityService,
    ServicesTimeService,
    ServicesPartsService,
    SupplierReceiptsService,
    InventoryService,
    SupportService,
  ],
  controllers: [
    ServicesCommerceController,
    PartnerLinksController,
    CatalogController,
    ServicesController,
    PurchasingController,
    SupportController,
    ServicesPlanningController,
  ],
  exports: [BusinessService, SupportService, ServicesPlanningService, ServicesCommerceService],
})
export class BusinessModule {}
