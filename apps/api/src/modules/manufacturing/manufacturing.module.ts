import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
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
  imports: [AuditLogsModule],
  controllers: [
    CalendarsController,
    WorkCentersController,
    RoutingsController,
    BomsController,
    OrdersController,
  ],
  providers: [
    CalendarsService,
    WorkCentersService,
    RoutingsService,
    BomsService,
    OrdersService,
  ],
  exports: [CalendarsService, WorkCentersService, RoutingsService, BomsService, OrdersService],
})
export class ManufacturingModule {}
