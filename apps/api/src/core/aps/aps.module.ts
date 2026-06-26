import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApsClient } from './aps.client';
import { ApsController } from './aps.controller';
import { ApsRuntimeService } from './aps-runtime.service';

/**
 * core/aps — manages the vendored PlaniAdvance APS engine (managed Python
 * sidecar) and exposes a typed client. Foundation sub-project: process
 * lifecycle, health, strategy listing and a smoke round-trip. Later
 * sub-projects (manufacturing master-data, planning) consume ApsClient.
 */
@Module({
  imports: [ConfigModule],
  controllers: [ApsController],
  providers: [ApsClient, ApsRuntimeService],
  exports: [ApsClient, ApsRuntimeService],
})
export class ApsModule {}
