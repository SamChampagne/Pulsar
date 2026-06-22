import { Module } from '@nestjs/common';
import { ControlTowerController } from './control-tower.controller';
import { ControlTowerService } from './control-tower.service';
import { FlowController } from './flow.controller';
import { FlowService } from './flow.service';
import { ScorecardsController } from './scorecards.controller';
import { ScorecardsService } from './scorecards.service';

/**
 * Analytics module — operational Control Tower (read-time KPIs + attention items)
 * + cross-module flow timeline / entity trace / flow map.
 *
 * PrismaService and TenantModulesCacheService come from the global PrismaModule
 * and do not need to be imported here.
 *
 * FlowService is exported so AgentsModule can inject it for the READ tools
 * get_flow_timeline and trace_entity (Task 4).
 */
@Module({
  controllers: [ControlTowerController, ScorecardsController, FlowController],
  providers: [ControlTowerService, ScorecardsService, FlowService],
  exports: [FlowService],
})
export class AnalyticsModule {}
