import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { MaintenanceController } from './maintenance/maintenance.controller';
import { MaintenanceService } from './maintenance/maintenance.service';
import { ComplianceController } from './compliance/compliance.controller';
import { ComplianceService } from './compliance/compliance.service';
import { FleetOverviewController } from './overview/fleet-overview.controller';
import { FleetOverviewService } from './overview/fleet-overview.service';
import { MaintenanceSchedulesController } from './schedules/maintenance-schedules.controller';
import { MaintenanceSchedulesService } from './schedules/maintenance-schedules.service';

/**
 * Fleet module (maintenance + compliance + overview).
 * Every controller in this module is gated by @RequireModule(MODULE_KEYS.FLEET):
 * tenants without the module enabled get a 403 from ModulesGuard.
 *
 * PrismaService + OwnershipService come from the @Global() PrismaModule;
 * AuditLogsService comes from the imported AuditLogsModule (same pattern as
 * TransportationModule).
 */
@Module({
  imports: [AuditLogsModule, forwardRef(() => OperatingModule)],
  controllers: [
    MaintenanceController,
    ComplianceController,
    FleetOverviewController,
    MaintenanceSchedulesController,
  ],
  providers: [
    MaintenanceService,
    ComplianceService,
    FleetOverviewService,
    MaintenanceSchedulesService,
  ],
  exports: [MaintenanceService, ComplianceService, FleetOverviewService],
})
export class FleetModule {}
