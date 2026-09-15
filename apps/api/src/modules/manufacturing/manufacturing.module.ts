import { forwardRef, Module } from '@nestjs/common';
import { OperatingModule } from '../../core/operating/operating.module';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { MrpAssistanceService } from './mrp/mrp-assistance.service';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { ApsModule } from '../../core/aps/aps.module';
import { CalendarsController } from './calendars/calendars.controller';
import { CalendarsService } from './calendars/calendars.service';
import { WorkCentersController } from './work-centers/work-centers.controller';
import { WorkCentersService } from './work-centers/work-centers.service';
import { RoutingsController } from './routings/routings.controller';
import { RoutingsService } from './routings/routings.service';
import { BomsController } from './boms/boms.controller';
import { BomsService } from './boms/boms.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { SchedulingController } from './scheduling/scheduling.controller';
import { SchedulingService } from './scheduling/scheduling.service';
import { MrpController } from './mrp/mrp.controller';
import { MrpService } from './mrp/mrp.service';
import { MrpDemandsService } from './mrp/mrp-demands.service';
import { MrpPreparationService } from './mrp/mrp-preparation.service';
import { MrpPreparationController } from './mrp/mrp-preparation.controller';
import { MaterialPurchasesService } from './purchasing/material-purchases.service';
import { MaterialPurchasesController } from './purchasing/material-purchases.controller';
import { WmsModule } from '../wms/wms.module';
import { ShopFloorController } from './shop-floor/shop-floor.controller';
import { ShopFloorService } from './shop-floor/shop-floor.service';
import { MaterialImpactService } from './scheduling/material-impact.service';

/**
 * Manufacturing / APS master-data module (sub-project 2). Pulsar owns this
 * data; SP3 projects it into the vendored APS engine's canonical snapshot.
 * Every controller is gated by @RequireModule(MODULE_KEYS.MANUFACTURING).
 *
 * PrismaService, OwnershipService and SequencesService come from the @Global()
 * PrismaModule; AuditLogsService comes from the imported AuditLogsModule (same
 * pattern as FleetModule / WmsModule).
 */
@Module({
  imports: [
    AuditLogsModule,
    ApsModule,
    WmsModule,
    ModuleRegistryModule,
    forwardRef(() => OperatingModule),
  ],
  controllers: [
    ShopFloorController,
    MaterialPurchasesController,
    MrpPreparationController,
    MrpController,
    CalendarsController,
    WorkCentersController,
    RoutingsController,
    BomsController,
    OrdersController,
    SchedulingController,
  ],
  providers: [
    MaterialImpactService,
    ShopFloorService,
    MaterialPurchasesService,
    MrpPreparationService,
    MrpAssistanceService,
    MrpDemandsService,
    MrpService,
    CalendarsService,
    WorkCentersService,
    RoutingsService,
    BomsService,
    OrdersService,
    SchedulingService,
  ],
  exports: [
    MrpAssistanceService,
    MrpService,
    CalendarsService,
    WorkCentersService,
    RoutingsService,
    BomsService,
    OrdersService,
    SchedulingService,
  ],
})
export class ManufacturingModule {}
