import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { TransportationModule } from '../../modules/transportation/transportation.module';
import { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import { LoadsService } from '../../modules/transportation/loads/loads.service';
import { RatingService } from '../../modules/transportation/rating/rating.service';
import { ShipmentsService } from '../../modules/transportation/shipments/shipments.service';
import { TendersService } from '../../modules/transportation/tenders/tenders.service';
import { AnalyticsService } from '../../modules/transportation/analytics/analytics.service';
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
  imports: [TransportationModule, AuditLogsModule, CryptoModule],
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
      ],
      useFactory: (
        transportOrders: TransportOrdersService,
        loads: LoadsService,
        rating: RatingService,
        shipments: ShipmentsService,
        tenders: TendersService,
        analytics: AnalyticsService,
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
      }),
    },
  ],
  exports: [AgentsService],
})
export class AgentsModule {}
