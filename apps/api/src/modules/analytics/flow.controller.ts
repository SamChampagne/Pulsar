import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { DossierRootType } from '@pulsar/shared';
import { DossierService } from './dossier.service';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { FlowService } from './flow.service';

const DEFAULT_DAYS = 7;
const VALID_DAYS = [1, 7, 30];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
class DossierQuery {
  @IsIn(['SALES_ORDER', 'TRANSPORT_ORDER', 'SHIPMENT', 'LOAD']) entityType!: DossierRootType;
  @IsString() @MinLength(1) @MaxLength(128) entityId!: string;
}

@ApiTags('analytics')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.ANALYTICS)
@Controller('analytics/flow')
export class FlowController {
  constructor(
    private readonly flow: FlowService,
    private readonly dossiers: DossierService,
  ) {}

  @Get('dossier')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  dossier(@CurrentUser() user: AuthUser, @Query() query: DossierQuery) {
    return this.dossiers.get(user, query.entityType, query.entityId);
  }

  private parseDays(raw?: string): number {
    const n = raw ? Number(raw) : DEFAULT_DAYS;
    return VALID_DAYS.includes(n) ? n : DEFAULT_DAYS;
  }

  private parseLimit(raw?: string): number {
    const n = raw ? Number(raw) : DEFAULT_LIMIT;
    return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT, 1), MAX_LIMIT);
  }

  @Get('timeline')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Lookback window (1, 7, 30). Default 7.',
  })
  @ApiQuery({
    name: 'modules',
    required: false,
    type: String,
    description: 'Comma-separated module names to filter.',
  })
  @ApiQuery({
    name: 'types',
    required: false,
    type: String,
    description: 'Comma-separated event types to filter.',
  })
  @ApiQuery({
    name: 'crossOnly',
    required: false,
    type: String,
    description: 'If "true", return only cross-module chains.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Max chains returned (1–${MAX_LIMIT}). Default ${DEFAULT_LIMIT}.`,
  })
  timeline(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('modules') modules?: string,
    @Query('types') types?: string,
    @Query('crossOnly') crossOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.flow.timeline(user.tenantId, {
      days: this.parseDays(days),
      modules: modules ? modules.split(',').filter(Boolean) : undefined,
      types: types ? types.split(',').filter(Boolean) : undefined,
      crossOnly: crossOnly === 'true',
      limit: this.parseLimit(limit),
    });
  }

  @Get('map')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Lookback window (1, 7, 30). Default 7.',
  })
  map(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.flow.map(user.tenantId, this.parseDays(days));
  }

  @Get('trace')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  @ApiQuery({
    name: 'entityType',
    required: true,
    type: String,
    description: 'TRANSPORT_ORDER | SHIPMENT | LOAD',
  })
  @ApiQuery({
    name: 'entityId',
    required: true,
    type: String,
    description: 'ID of the root entity.',
  })
  trace(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD',
    @Query('entityId') entityId: string,
  ) {
    return this.flow.trace(user.tenantId, entityType, entityId);
  }
}
