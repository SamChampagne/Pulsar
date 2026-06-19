import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ScorecardsService } from './scorecards.service';

const VALID_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

@ApiTags('analytics')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.ANALYTICS)
@Controller('analytics')
export class ScorecardsController {
  constructor(private readonly scorecards: ScorecardsService) {}

  @Get('scorecards')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Lookback window in days (7, 30, 90). Default 30.' })
  get(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    const parsed = days ? Number(days) : DEFAULT_DAYS;
    const d = VALID_DAYS.includes(parsed as (typeof VALID_DAYS)[number])
      ? parsed
      : Math.min(Math.max(parsed > 0 ? parsed : DEFAULT_DAYS, 1), MAX_DAYS);
    return this.scorecards.scorecards(user.tenantId, d);
  }
}
