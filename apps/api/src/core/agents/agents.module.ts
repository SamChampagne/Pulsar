import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AiDraftService } from '../email/ai-draft.service';
import { MailService } from '../email/mail.service';
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
import { LedgerService } from '../../modules/billing/ledger/ledger.service';
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
import { ThreadsService } from '../../modules/crm/threads.service';
import { ProductsService } from '../../modules/crm/products.service';
import { SalesOrdersService } from '../../modules/crm/sales-orders.service';
import { SequencesService as CrmSequencesService } from '../../modules/crm/sequences.service';
import { ManufacturingModule } from '../../modules/manufacturing/manufacturing.module';
import { SchedulingService } from '../../modules/manufacturing/scheduling/scheduling.service';
import { OrdersService as ManufacturingOrdersService } from '../../modules/manufacturing/orders/orders.service';
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
    ManufacturingModule,
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
        LedgerService,
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
        ThreadsService,
        ProductsService,
        SalesOrdersService,
        AiDraftService,
        MailService,
        SchedulingService,
        ManufacturingOrdersService,
        CrmSequencesService,
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
        ledger: LedgerService,
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
        threads: ThreadsService,
        products: ProductsService,
        salesOrders: SalesOrdersService,
        aiDraft: AiDraftService,
        mail: MailService,
        scheduling: SchedulingService,
        mfgOrders: ManufacturingOrdersService,
        crmSequences: CrmSequencesService,
      ): ToolServices => ({
        transportOrders: {
          list: (tenantId, query) => transportOrders.list(tenantId, query as never),
          createFromSalesOrder: (tenantId, userId, salesOrderId, dto) =>
            transportOrders.createFromSalesOrder(tenantId, userId, salesOrderId, dto as never),
          salesOrderFulfillmentContext: (tenantId, salesOrderId) =>
            transportOrders.getSalesOrderFulfillmentContext(tenantId, salesOrderId),
        },
        loads: {
          get: (tenantId, id) => loads.get(tenantId, id),
          create: (tenantId, userId, dto) => loads.create(tenantId, userId, dto as never),
          capacitySummary: (tenantId, id) => loads.capacitySummary(tenantId, id),
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
          list: (t, filter) => operationalTasks.list(t, filter as never),
        },
        freightAudit: {
          audit: (t, u, id) => freightAudit.audit(t, u, id),
          dispute: (t, a, id, dto, agentId) =>
            freightAudit.dispute(t, a, id, dto as never, agentId),
        },
        ledger: {
          trialBalance: (tenantId, asOf) => ledger.trialBalance(tenantId, asOf),
          listJournal: (tenantId, query) => ledger.listJournal(tenantId, query),
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
          assign: (tenantId, userId, visitId, dto) => visits.assign(tenantId, userId, visitId, dto),
          move: (tenantId, userId, visitId, dto) => visits.move(tenantId, userId, visitId, dto),
          checkOut: (tenantId, userId, visitId) => visits.checkOut(tenantId, userId, visitId),
        },
        yardOverview: {
          overview: (tenantId) => yardOverview.overview(tenantId),
          board: (tenantId, locationId) => yardOverview.board(tenantId, locationId),
        },
        yardAppointments: {
          create: (tenantId, userId, dto) => appointments.create(tenantId, userId, dto as never),
          arrive: (tenantId, userId, id) => appointments.arrive(tenantId, userId, id),
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
          timeline: (tenantId, opts) =>
            flow.timeline(tenantId, {
              days: opts.days ?? 7,
              limit: opts.limit ?? 200,
              modules: opts.modules,
              crossOnly: opts.crossOnly,
            }),
          trace: (tenantId, entityType, entityId) => flow.trace(tenantId, entityType, entityId),
        },
        crm: {
          sendSequenceStep: (tenantId, stepId, agentId, preview) =>
            crmSequences.sendStep(tenantId, stepId, agentId, preview),
          listDeals: (tenantId, query) => deals.list(tenantId, query as never),
          getCompany: (tenantId, id) => companies.get(tenantId, id),
          listActivities: (tenantId, query) => activities.list(tenantId, query as never),
          logActivity: (tenantId, input, author) =>
            activities.create(tenantId, input as never, author),
          advanceDeal: (tenantId, id, userId, stage) =>
            deals.advance(tenantId, id, userId, stage as never),
          createFollowup: (tenantId, input, author) =>
            activities.create(tenantId, { ...(input as object), type: 'TASK' } as never, author),
          getDeal: (tenantId, id) => deals.getWithContext(tenantId, id),
          listThreads: (tenantId, query) => threads.list(tenantId, query as never),
          getThread: (tenantId, id) => threads.get(tenantId, id),
          replyThread: (tenantId, id, dto, author) => threads.reply(tenantId, id, dto, author),
          linkThread: (tenantId, id, dto, userId) =>
            threads.link(tenantId, id, dto as never, userId),
          listProducts: (tenantId, query) => products.list(tenantId, query as never),
          listSalesOrders: (tenantId, query) => salesOrders.list(tenantId, query as never),
        },
        manufacturingOrders: {
          list: (tenantId, query) => mfgOrders.list(tenantId, query as never),
        },
        manufacturingPlanning: {
          baseline: (tenantId) => scheduling.baseline(tenantId),
          listRuns: (tenantId, query) => scheduling.list(tenantId, query as never),
          run: (tenantId, userId, input) => scheduling.run(tenantId, userId, input),
          publish: (tenantId, userId, runId) => scheduling.publish(tenantId, userId, runId),
        },
        email: {
          draft: (tenantId, input) => aiDraft.draft(tenantId, input),
          send: (tenantId, input, author) =>
            mail.queue(tenantId, { ...input, agentId: author.agentId }),
        },
      }),
    },
  ],
  exports: [AgentsService, AgentRuntimeService],
})
export class AgentsModule {}
