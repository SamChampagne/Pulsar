import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * PrismaService comes from the @Global() PrismaModule; the agent/APS
 * `isInstalled()` helpers are plain fs-based functions with no DI needs.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
