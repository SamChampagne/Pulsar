import { Module } from '@nestjs/common';
import { ServicesAcceptanceController } from './services-acceptance.controller';
import { ServicesAcceptanceService } from './services-acceptance.service';
import { CatalogPackagingService } from './catalog-packaging.service';
import {
  CatalogPackagingControllers,
  PurchasePackageScanController,
} from './catalog-packaging.controllers';
import { CatalogDetailsService } from './catalog-details.service';
import { CatalogDetailsControllers, CatalogOfferControllers } from './catalog-details.controllers';
import { DocumentCoordinatesModule } from '../../core/reference-data/document-coordinates.module';
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
  imports: [AuditLogsModule, DocumentCoordinatesModule],
  providers: [
    ServicesAcceptanceService,
    CatalogPackagingService,
    CatalogDetailsService,
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
    ServicesAcceptanceController,
    ...CatalogPackagingControllers,
    PurchasePackageScanController,
    ...CatalogDetailsControllers,
    ...CatalogOfferControllers,
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
