import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ControlTowerService } from './control-tower.service';

const VALID_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

@ApiTags('analytics')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.ANALYTICS)
@Controller('analytics')
export class ControlTowerController {
  constructor(private readonly controlTower: ControlTowerService) {}

  @Get('control-tower')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Lookback window in days (7, 30, 90). Default 30.' })
  get(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    const parsed = days ? Number(days) : DEFAULT_DAYS;
    // Clamp to sane set; fallback to default if value is not in the valid set
    const d = VALID_DAYS.includes(parsed as (typeof VALID_DAYS)[number])
      ? parsed
      : Math.min(Math.max(parsed > 0 ? parsed : DEFAULT_DAYS, 1), MAX_DAYS);
    return this.controlTower.controlTower(user.tenantId, d);
  }
}
