import { Module } from '@nestjs/common';
import { DeliveryAssistanceService } from './delivery-operations/delivery-assistance.service';
import { DeliveryOperationsController } from './delivery-operations/delivery-operations.controller';
import { DeliveryOperationsService } from './delivery-operations/delivery-operations.service';
import { DeliveryExceptionsService } from './delivery-exceptions/delivery-exceptions.service';
import { DeliveryExceptionsController } from './delivery-exceptions/delivery-exceptions.controller';
import { DeliveryAllocationController } from './delivery-allocation/delivery-allocation.controller';
import { DeliveryAllocationService } from './delivery-allocation/delivery-allocation.service';
import { DeliveryFuelController } from './delivery-fuel/delivery-fuel.controller';
import { DeliveryFuelService } from './delivery-fuel/delivery-fuel.service';
import {
  DriverDocumentsController,
  PublicDriverDocumentsController,
} from './driver-documents/driver-documents.controller';
import { DriverDocumentsService } from './driver-documents/driver-documents.service';
import { DriverAccessService } from './public/driver-access.service';
import { DriverPackagesService } from './public/driver-packages.service';
import { DriverPackagesController } from './public/driver-packages.controller';
import { DeliveryManifestsController } from './delivery-manifests/delivery-manifests.controller';
import { DeliveryManifestsService } from './delivery-manifests/delivery-manifests.service';
import { DeliveryPackagesController } from './delivery-packages/delivery-packages.controller';
import { DeliveryPackagesService } from './delivery-packages/delivery-packages.service';
import { DocumentCoordinatesModule } from '../../core/reference-data/document-coordinates.module';
import { OperationalRecordsModule } from '../../core/reference-data/operational-records.module';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CoreLocationsModule } from '../../core/locations/locations.module';
import { DocumentsModule } from '../../core/documents/documents.module';
import { IntegrationsModule } from '../../core/integrations/integrations.module';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { NotificationsModule } from '../../core/notifications/notifications.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { DelayDetectionService } from './exceptions/delay-detection.service';
import { CustomersController } from './customers/customers.controller';
import { LocationsController } from './locations/locations.controller';
import { CarriersController } from './carriers/carriers.controller';
import { DriversController } from './drivers/drivers.controller';
import { VehiclesController } from './vehicles/vehicles.controller';
import { TrailersController } from './trailers/trailers.controller';
import { RatesController } from './rates/rates.controller';
import { RatesService } from './rates/rates.service';
import { TransportOrdersController } from './transport-orders/transport-orders.controller';
import { TransportOrdersService } from './transport-orders/transport-orders.service';
import { ShipmentsController } from './shipments/shipments.controller';
import { ShipmentsService } from './shipments/shipments.service';
import { LoadsController } from './loads/loads.controller';
import { LoadsService } from './loads/loads.service';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';
import { TrackingController } from './tracking/tracking.controller';
import { TrackingService } from './tracking/tracking.service';
import { TendersService } from './tenders/tenders.service';
import { TenderExpiryService } from './tenders/tender-expiry.service';
import { LanesController } from './lanes/lanes.controller';
import { LanesService } from './lanes/lanes.service';
import { LoadCostService } from './loads/load-cost.service';
import { LoadNotificationsService } from './loads/load-notifications.service';
import { PublicLinksController } from './public/public-links.controller';
import { PublicLinksService } from './public/public-links.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AccessorialsController } from './accessorials/accessorials.controller';
import { AccessorialsService } from './accessorials/accessorials.service';
import { FuelTablesController } from './fuel-tables/fuel-tables.controller';
import { FuelTablesService } from './fuel-tables/fuel-tables.service';
import { RatingController } from './rating/rating.controller';
import { RatingService } from './rating/rating.service';
import { BolService } from './bol/bol.service';
import { PlanningBoardController } from './planning-board/planning-board.controller';
import { PlanningBoardService } from './planning-board/planning-board.service';
import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';
import { CustomFieldsController } from './custom-fields/custom-fields.controller';

/**
 * Transportation Management module (TMS).
 * Every controller in this module is gated by @RequireModule(MODULE_KEYS.TRANSPORTATION):
 * tenants without the module enabled get a 403 from ModulesGuard.
 */
@Module({
  imports: [
    DocumentCoordinatesModule,
    OperationalRecordsModule,
    AuditLogsModule,
    CoreLocationsModule,
    CustomFieldsModule,
    DocumentsModule,
    IntegrationsModule,
    ModuleRegistryModule,
    NotificationsModule,
    OperatingModule,
  ],
  controllers: [
    DeliveryOperationsController,
    DeliveryExceptionsController,
    DeliveryAllocationController,
    DeliveryFuelController,
    DriverDocumentsController,
    PublicDriverDocumentsController,
    DriverPackagesController,
    DeliveryManifestsController,
    DeliveryPackagesController,
    CustomersController,
    LocationsController,
    CarriersController,
    DriversController,
    VehiclesController,
    TrailersController,
    RatesController,
    TransportOrdersController,
    ShipmentsController,
    LoadsController,
    RoutesController,
    TrackingController,
    AnalyticsController,
    LanesController,
    AccessorialsController,
    FuelTablesController,
    PlanningBoardController,
    RatingController,
    CustomFieldsController,
    // Public, token-authenticated endpoints (tender response, tracking, driver)
    PublicLinksController,
  ],
  providers: [
    DeliveryAssistanceService,
    DeliveryOperationsService,
    DeliveryExceptionsService,
    DeliveryAllocationService,
    DeliveryFuelService,
    DriverDocumentsService,
    DriverAccessService,
    DriverPackagesService,
    DeliveryManifestsService,
    DeliveryPackagesService,
    RatesService,
    TransportOrdersService,
    ShipmentsService,
    LoadsService,
    RoutesService,
    TrackingService,
    TendersService,
    TenderExpiryService,
    LanesService,
    LoadCostService,
    LoadNotificationsService,
    RatingService,
    PublicLinksService,
    AnalyticsService,
    AccessorialsService,
    FuelTablesService,
    BolService,
    DelayDetectionService,
    PlanningBoardService,
  ],
  exports: [
    DeliveryAssistanceService,
    DeliveryExceptionsService,
    DeliveryOperationsService,
    CustomFieldsModule,
    RatingService,
    // Consumed by the AgentsModule tool-services adapter (core/agents).
    TransportOrdersService,
    LoadsService,
    ShipmentsService,
    TendersService,
    AnalyticsService,
    OperationalRecordsModule,
  ],
})
export class TransportationModule {}
