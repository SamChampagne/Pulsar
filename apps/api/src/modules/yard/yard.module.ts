import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { SpotsService } from './spots/spots.service';
import { SpotsController } from './spots/spots.controller';
import { VisitsService } from './visits/visits.service';
import { VisitsController } from './visits/visits.controller';
import { AppointmentsService } from './appointments/appointments.service';
import { AppointmentsController } from './appointments/appointments.controller';
import { YardOverviewService } from './overview/yard-overview.service';
import { YardOverviewController } from './overview/yard-overview.controller';

/**
 * Yard Management module (spots master-data + gate visits + dock appointments +
 * live board/overview). Every controller is gated by
 * @RequireModule(MODULE_KEYS.YARD): tenants without the module enabled get a 403
 * from ModulesGuard.
 *
 * PrismaService, OwnershipService and SequencesService all come from the
 * @Global() PrismaModule; AuditLogsService comes from the imported
 * AuditLogsModule (same pattern as WmsModule / FleetModule).
 */
@Module({
  imports: [AuditLogsModule, forwardRef(() => OperatingModule)],
  controllers: [SpotsController, VisitsController, AppointmentsController, YardOverviewController],
  providers: [SpotsService, VisitsService, AppointmentsService, YardOverviewService],
  exports: [VisitsService, AppointmentsService, YardOverviewService],
})
export class YardModule {}
