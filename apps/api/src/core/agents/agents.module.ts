import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperatingModule } from '../operating/operating.module';
import { TransportationModule } from '../../modules/transportation/transportation.module';
import { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import { LoadsService } from '../../modules/transportation/loads/loads.service';
import { RatingService } from '../../modules/transportation/rating/rating.service';
import { ShipmentsService } from '../../modules/transportation/shipments/shipments.service';
import { TendersService } from '../../modules/transportation/tenders/tenders.service';
import { AnalyticsService } from '../../modules/transportation/analytics/analytics.service';
import { VehiclesService } from '../../modules/transportation/vehicles/vehicles.service';
import { TrailersService } from '../../modules/transportation/trailers/trailers.service';
import { OperationalTasksService } from '../operating/operational-tasks.service';
import { BillingModule } from '../../modules/billing/billing.module';
import { FreightAuditService } from '../../modules/billing/freight-audit/freight-audit.service';
import { FleetModule } from '../../modules/fleet/fleet.module';
import { MaintenanceService } from '../../modules/fleet/maintenance/maintenance.service';
import { ComplianceService } from '../../modules/fleet/compliance/compliance.service';
import { FleetOverviewService } from '../../modules/fleet/overview/fleet-overview.service';
import { YardModule } from '../../modules/yard/yard.module';
import { VisitsService } from '../../modules/yard/visits/visits.service';
import { AppointmentsService } from '../../modules/yard/appointments/appointments.service';
import { YardOverviewService } from '../../modules/yard/overview/yard-overview.service';
import { WmsModule } from '../../modules/wms/wms.module';
import { WmsOverviewService } from '../../modules/wms/overview/wms-overview.service';
import { PickingService } from '../../modules/wms/picking/picking.service';
import { CycleCountsService } from '../../modules/wms/cycle-counts/cycle-counts.service';
import { AnalyticsModule } from '../../modules/analytics/analytics.module';
import { FlowService } from '../../modules/analytics/flow.service';
import { CrmModule } from '../../modules/crm/crm.module';
import { CompaniesService } from '../../modules/crm/companies.service';
import { DealsService } from '../../modules/crm/deals.service';
import { ActivitiesService } from '../../modules/crm/activities.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { ProposedActionsController } from './proposed-actions.controller';
import { ProposedActionsService } from './proposed-actions.service';
import { McpController } from './mcp.controller';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentConversationsController } from './agent-conversations.controller';
import { RuntimeConfigService } from './runtime-config.service';
import { RuntimeConfigController } from './runtime-config.controller';

/**
 * Agent governance + MCP exposure (phase 11).
 *
 * Binds the abstract `ToolServices` contract (tool-registry.ts) to the REAL
 * Transportation services and wires the agent/MCP controllers. PrismaService,
 * TenantModulesCacheService (PrismaModule is @Global) and AuditLogsService
 * (AuditLogsModule) reach the agent services without explicit imports here for
 * Prisma; AuditLogsModule is imported for ProposedActionsService.
 *
 * Not @Global: nothing outside this module needs the providers at module scope,
 * and importing TransportationModule globally would risk widening its surface.
 */
@Module({
  imports: [
    TransportationModule,
    AuditLogsModule,
    CryptoModule,
    NotificationsModule,
    forwardRef(() => OperatingModule),
    forwardRef(() => BillingModule),
    FleetModule,
    YardModule,
    WmsModule,
    AnalyticsModule,
    CrmModule,
  ],
  controllers: [
    AgentsController,
    ProposedActionsController,
    McpController,
    AgentConversationsController,
    RuntimeConfigController,
  ],
  providers: [
    AgentsService,
    ProposedActionsService,
    AgentRuntimeService,
    AgentConversationsService,
    RuntimeConfigService,
    {
      provide: AGENT_TOOL_SERVICES,
      inject: [
        TransportOrdersService,
        LoadsService,
        RatingService,
        ShipmentsService,
        TendersService,
        AnalyticsService,
        VehiclesService,
        TrailersService,
        OperationalTasksService,
        FreightAuditService,
        MaintenanceService,
        ComplianceService,
        FleetOverviewService,
        VisitsService,
        AppointmentsService,
        YardOverviewService,
        WmsOverviewService,
        PickingService,
        CycleCountsService,
        FlowService,
        CompaniesService,
        DealsService,
        ActivitiesService,
      ],
      useFactory: (
        transportOrders: TransportOrdersService,
        loads: LoadsService,
        rating: RatingService,
        shipments: ShipmentsService,
        tenders: TendersService,
        analytics: AnalyticsService,
        vehicles: VehiclesService,
        trailers: TrailersService,
        operationalTasks: OperationalTasksService,
        freightAudit: FreightAuditService,
        maintenance: MaintenanceService,
        compliance: ComplianceService,
        fleetOverview: FleetOverviewService,
        visits: VisitsService,
        appointments: AppointmentsService,
        yardOverview: YardOverviewService,
        wmsOverview: WmsOverviewService,
        picking: PickingService,
        cycleCounts: CycleCountsService,
        flow: FlowService,
        companies: CompaniesService,
        deals: DealsService,
        activities: ActivitiesService,
      ): ToolServices => ({
        transportOrders: {
          list: (tenantId, query) => transportOrders.list(tenantId, query as never),
        },
        loads: {
          get: (tenantId, id) => loads.get(tenantId, id),
          create: (tenantId, userId, dto) => loads.create(tenantId, userId, dto as never),
        },
        rating: {
          rateOptions: (tenantId, loadId) => rating.rateOptions(tenantId, loadId),
        },
        shipments: {
          list: (tenantId, query) => shipments.list(tenantId, query as never),
          assignToLoad: (tenantId, userId, id, dto) =>
            shipments.assignToLoad(tenantId, userId, id, dto),
        },
        tenders: {
          create: (tenantId, userId, loadId, input) =>
            tenders.create(tenantId, userId, loadId, input),
        },
        analytics: {
          carrierScorecards: (tenantId) => analytics.carrierScorecards(tenantId),
        },
        operatingTasks: {
          listForAgent: (t, a) => operationalTasks.listForAgent(t, a),
          getForTenant: (t, id) => operationalTasks.getForTenant(t, id),
          resolve: (t, id, u, note) => operationalTasks.resolve(t, id, u, note),
        },
        freightAudit: {
          audit: (t, u, id) => freightAudit.audit(t, u, id),
          dispute: (t, a, id, dto, agentId) => freightAudit.dispute(t, a, id, dto as never, agentId),
        },
        vehicles: {
          list: (tenantId, query) => vehicles.list(tenantId, query as never),
          get: (tenantId, id) => vehicles.get(tenantId, id),
        },
        trailers: {
          list: (tenantId, query) => trailers.list(tenantId, query as never),
          get: (tenantId, id) => trailers.get(tenantId, id),
        },
        fleetOverview: {
          overview: (tenantId) => fleetOverview.overview(tenantId),
        },
        fleetCompliance: {
          expiring: (tenantId, days) => compliance.expiring(tenantId, days),
        },
        fleetMaintenance: {
          create: (tenantId, userId, dto) => maintenance.create(tenantId, userId, dto as never),
        },
        yardVisits: {
          list: (tenantId, q) => visits.list(tenantId, q as never),
          get: (tenantId, id) => visits.get(tenantId, id),
          assign: (tenantId, userId, visitId, dto) =>
            visits.assign(tenantId, userId, visitId, dto),
          move: (tenantId, userId, visitId, dto) =>
            visits.move(tenantId, userId, visitId, dto),
          checkOut: (tenantId, userId, visitId) =>
            visits.checkOut(tenantId, userId, visitId),
        },
        yardOverview: {
          overview: (tenantId) => yardOverview.overview(tenantId),
          board: (tenantId, locationId) => yardOverview.board(tenantId, locationId),
        },
        yardAppointments: {
          create: (tenantId, userId, dto) =>
            appointments.create(tenantId, userId, dto as never),
          arrive: (tenantId, userId, id) =>
            appointments.arrive(tenantId, userId, id),
        },
        wmsOverview: {
          overview: (tenantId) => wmsOverview.overview(tenantId),
        },
        wmsPicking: {
          get: (tenantId, id) => picking.get(tenantId, id),
        },
        wmsCycleCounts: {
          create: (tenantId, userId, dto) => cycleCounts.create(tenantId, userId, dto),
        },
        flow: {
          timeline: (tenantId, opts) => flow.timeline(tenantId, { days: opts.days ?? 7, limit: opts.limit ?? 200, modules: opts.modules, crossOnly: opts.crossOnly }),
          trace: (tenantId, entityType, entityId) => flow.trace(tenantId, entityType, entityId),
        },
        crm: {
          listDeals: (tenantId, query) => deals.list(tenantId, query as never),
          getCompany: (tenantId, id) => companies.get(tenantId, id),
          listActivities: (tenantId, query) => activities.list(tenantId, query as never),
          logActivity: (tenantId, input, author) =>
            activities.create(tenantId, input as never, author),
          advanceDeal: (tenantId, id, userId, stage) =>
            deals.advance(tenantId, id, userId, stage as never),
          createFollowup: (tenantId, input, author) =>
            activities.create(tenantId, { ...(input as object), type: 'TASK' } as never, author),
        },
      }),
    },
  ],
  exports: [AgentsService, AgentRuntimeService],
})
export class AgentsModule {}
