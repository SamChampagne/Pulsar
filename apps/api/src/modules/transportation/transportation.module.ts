import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
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

/**
 * Transportation Management module (TMS).
 * Every controller in this module is gated by @RequireModule(MODULE_KEYS.TRANSPORTATION):
 * tenants without the module enabled get a 403 from ModulesGuard.
 */
@Module({
  imports: [AuditLogsModule],
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
  ],
})
export class TransportationModule {}
