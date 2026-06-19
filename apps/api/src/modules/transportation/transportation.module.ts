import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { DocumentsModule } from '../../core/documents/documents.module';
import { IntegrationsModule } from '../../core/integrations/integrations.module';
import { NotificationsModule } from '../../core/notifications/notifications.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { DelayDetectionService } from './exceptions/delay-detection.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { CarriersController } from './carriers/carriers.controller';
import { CarriersService } from './carriers/carriers.service';
import { DriversController } from './drivers/drivers.controller';
import { DriversService } from './drivers/drivers.service';
import { VehiclesController } from './vehicles/vehicles.controller';
import { VehiclesService } from './vehicles/vehicles.service';
import { TrailersController } from './trailers/trailers.controller';
import { TrailersService } from './trailers/trailers.service';
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
import { PublicLinksController } from './public/public-links.controller';
import { PublicLinksService } from './public/public-links.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AccessorialsController } from './accessorials/accessorials.controller';
import { AccessorialsService } from './accessorials/accessorials.service';
import { FuelTablesController } from './fuel-tables/fuel-tables.controller';
import { FuelTablesService } from './fuel-tables/fuel-tables.service';
import { RatingService } from './rating/rating.service';
import { BolService } from './bol/bol.service';
import { PlanningBoardController } from './planning-board/planning-board.controller';
import { PlanningBoardService } from './planning-board/planning-board.service';

/**
 * Transportation Management module (TMS).
 * Every controller in this module is gated by @RequireModule(MODULE_KEYS.TRANSPORTATION):
 * tenants without the module enabled get a 403 from ModulesGuard.
 */
@Module({
  imports: [AuditLogsModule, DocumentsModule, IntegrationsModule, NotificationsModule, OperatingModule],
  controllers: [
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
    // Public, token-authenticated endpoints (tender response, tracking, driver)
    PublicLinksController,
  ],
  providers: [
    CustomersService,
    LocationsService,
    CarriersService,
    DriversService,
    VehiclesService,
    TrailersService,
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
    RatingService,
    // Consumed by the AgentsModule tool-services adapter (core/agents).
    TransportOrdersService,
    LoadsService,
    ShipmentsService,
    TendersService,
    AnalyticsService,
    VehiclesService,
    TrailersService,
    // Consumed by ConnectModule (CSV importer).
    CustomersService,
    LocationsService,
    CarriersService,
  ],
})
export class TransportationModule {}
