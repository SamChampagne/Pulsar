import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * Infra-only endpoints — no `@RequireModule`/`@RequirePermissions`, and
 * `@Public()` so `JwtAuthGuard` lets them through without a JWT. `ModulesGuard`
 * and `PermissionsGuard` already no-op when no module/permission metadata is
 * present, so these routes need no further exemption.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('live')
  liveness() {
    return this.health.liveness();
  }

  @Public()
  @Get('ready')
  async readiness(@Res() res: Response): Promise<void> {
    const result = await this.health.readiness();
    const httpStatus = result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(httpStatus).json(result);
  }
}
