import { Module } from '@nestjs/common';
import { ControlTowerController } from './control-tower.controller';
import { ControlTowerService } from './control-tower.service';
import { ScorecardsController } from './scorecards.controller';
import { ScorecardsService } from './scorecards.service';

/**
 * Analytics module — operational Control Tower (read-time KPIs + attention items).
 *
 * PrismaService and TenantModulesCacheService come from the global PrismaModule
 * and do not need to be imported here.
 */
@Module({
  controllers: [ControlTowerController, ScorecardsController],
  providers: [ControlTowerService, ScorecardsService],
})
export class AnalyticsModule {}
