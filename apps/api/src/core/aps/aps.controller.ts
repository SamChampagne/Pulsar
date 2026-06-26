import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@pulsar/shared';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApsClient } from './aps.client';
import { ApsRuntimeService } from './aps-runtime.service';
import { buildSmokeSnapshot } from './smoke-snapshot';

class SmokeDto {
  @IsOptional()
  @IsString()
  @IsIn(['greedy', 'backward', 'hybrid', 'cpsat', 'infinite', 'sa', 'tabu', 'ga', 'lns', 'multi', 'auto'])
  strategy?: string;
}

/**
 * Diagnostics surface for the APS runtime foundation. Platform-scoped (no
 * @RequireModule yet — the MANUFACTURING module key arrives in sub-project 2).
 * `/status` doubles as an ops health page; `/smoke` proves the end-to-end
 * Pulsar↔engine round-trip on demand.
 */
@ApiTags('core/aps')
@ApiBearerAuth()
@Controller('aps')
export class ApsController {
  constructor(
    private readonly runtime: ApsRuntimeService,
    private readonly client: ApsClient,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.CORE.APS_READ)
  status() {
    return this.runtime.status();
  }

  @Get('strategies')
  @RequirePermissions(PERMISSIONS.CORE.APS_READ)
  strategies() {
    return this.client.listStrategies();
  }

  @Post('smoke')
  @RequirePermissions(PERMISSIONS.CORE.APS_ADMIN)
  async smoke(@Body() dto: SmokeDto) {
    const strategies = await this.client.listStrategies();
    const result = await this.client.schedule(buildSmokeSnapshot(), {
      strategy: dto.strategy ?? 'greedy',
      horizonDays: 14,
    });
    const byOp = new Map(result.assignments.map((a) => [a.operation_id, a]));
    const op1 = byOp.get('smoke-op-1');
    const op2 = byOp.get('smoke-op-2');
    return {
      strategyUsed: dto.strategy ?? 'greedy',
      availableStrategies: strategies.strategies.map((s) => s.name),
      scheduleId: result.schedule_id,
      solverStatus: result.solver_status,
      objectiveValue: result.objective_value,
      wallTimeMs: result.wall_time_ms,
      assignments: result.assignments,
      precedenceRespected: !!op1 && !!op2 && op2.start >= op1.end,
    };
  }
}
