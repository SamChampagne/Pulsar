import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { LotsService } from './lots.service';
import { CreateLotDto, LotQueryDto, HoldLotDto, ReleaseLotDto } from './lots.dto';
import { LotDisposition } from '@pulsar/shared';
import { LotTraceService } from './lot-trace.service';
import { LotTraceQueryDto, LotTraceDossiersDto } from './lot-trace.dto';
@ApiTags('wms/lots')
@ApiBearerAuth()
@RequireModule('wms')
@Controller('wms/items/:itemId/lots')
export class LotsController {
  constructor(
    private readonly service: LotsService,
    private readonly traceService: LotTraceService,
  ) {}
  @Get(':id/trace')
  @RequirePermissions('wms.read')
  trace(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Query() q: LotTraceQueryDto,
  ) {
    return this.traceService.trace(u, itemId, id, q);
  }
  @Get(':id/trace-dossiers')
  @RequirePermissions('wms.read')
  traceDossiers(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Query() q: LotTraceDossiersDto,
  ) {
    return this.traceService.dossiers(u, itemId, id, q);
  }
  @Get(':id/quality-inspections')
  @RequirePermissions('wms.read', 'quality.read')
  qualityInspections(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Query() q: LotQueryDto,
  ) {
    return this.service.qualityInspections(u, itemId, id, q);
  }
  @Get(':id/affected-preparations')
  @RequirePermissions('wms.read')
  affectedPreparations(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Query() q: LotQueryDto,
  ) {
    return this.service.affectedPreparations(u.tenantId, itemId, id, q);
  }
  @Get(':id/decisions')
  @RequirePermissions('wms.read')
  decisions(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Query() q: LotQueryDto,
  ) {
    return this.service.decisions(u, itemId, id, q);
  }
  @Post(':id/quarantine')
  @RequirePermissions('wms.read', 'wms.manage')
  quarantine(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Body() d: HoldLotDto,
  ) {
    return this.service.decide(u, itemId, id, LotDisposition.QUARANTINED, d);
  }
  @Post(':id/release')
  @RequirePermissions('wms.read', 'wms.manage', 'wms.lots.release')
  release(
    @CurrentUser() u: AuthUser,
    @Param('itemId') itemId: string,
    @Param('id') id: string,
    @Body() d: ReleaseLotDto,
  ) {
    return this.service.decide(u, itemId, id, LotDisposition.UNRESTRICTED, d);
  }
  @Get()
  @RequirePermissions('wms.read')
  list(@CurrentUser() u: AuthUser, @Param('itemId') id: string, @Query() q: LotQueryDto) {
    return this.service.list(u.tenantId, id, q);
  }
  @Get(':id')
  @RequirePermissions('wms.read')
  get(@CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Param('id') id: string) {
    return this.service.get(u.tenantId, itemId, id);
  }
  @Post()
  @RequirePermissions('wms.read', 'wms.manage')
  @Audit('wms-lot', AuditAction.CREATE)
  create(@CurrentUser() u: AuthUser, @Param('itemId') id: string, @Body() d: CreateLotDto) {
    return this.service.create(u.tenantId, id, d);
  }
}
