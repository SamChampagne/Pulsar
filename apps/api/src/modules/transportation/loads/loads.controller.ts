import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { LoadStatus, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { IsInt, IsOptional as IsOpt, IsString, Max, Min } from 'class-validator';
import { TendersService } from '../tenders/tenders.service';
import { AssignLoadResourcesDto, CreateLoadDto, SetLoadAccessorialsDto } from './dto/load.dto';
import { LoadsService } from './loads.service';
import { RatingService } from '../rating/rating.service';
import { BolService } from '../bol/bol.service';

class CreateTenderDto {
  @IsOpt()
  @IsString()
  carrierId?: string;

  @IsOpt()
  @IsString()
  message?: string;

  @IsOpt()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}

class ConsolidateDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  shipmentIds!: string[];
}

class LoadListQueryDto extends ListQueryDto {
  /** Accepts a single value (`?status=OPEN`, backward-compatible) or a
   *  comma-separated list (`?status=OPEN,PLANNED`) — e.g. the shipments
   *  "assign to load" picker, which needs both. */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : String(value)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  )
  @IsArray()
  @IsEnum(LoadStatus, { each: true })
  status?: LoadStatus[];
}

@ApiTags('transportation/loads')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/loads')
export class LoadsController {
  constructor(
    private readonly loads: LoadsService,
    private readonly tenders: TendersService,
    private readonly rating: RatingService,
    private readonly bol: BolService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: LoadListQueryDto) {
    return this.loads.list(user.tenantId, query);
  }

  /** Operational dashboard map — markers only, no geometry (spec §C). */
  @Get('active-map')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  activeMap(@CurrentUser() user: AuthUser) {
    return this.loads.activeMap(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoadDto) {
    return this.loads.create(user.tenantId, user.id, dto);
  }

  /** Atomically create a load from a set of unassigned shipments (dispatch workbench). */
  @Post('consolidate')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  consolidate(@CurrentUser() user: AuthUser, @Body() dto: ConsolidateDto) {
    return this.loads.consolidate(user.tenantId, user.id, dto.shipmentIds);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignLoadResourcesDto,
  ) {
    return this.loads.assignResources(user.tenantId, user.id, id, dto);
  }

  @Post(':id/dispatch')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  dispatch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.dispatch(user.tenantId, user.id, id);
  }

  @Post(':id/start-transit')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  startTransit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.startTransit(user.tenantId, user.id, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.complete(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.cancel(user.tenantId, user.id, id);
  }

  // --- Carrier tendering ------------------------------------------------------

  @Get(':id/tenders')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  listTenders(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tenders.listForLoad(user.tenantId, id);
  }

  @Post(':id/tender')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  tender(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateTenderDto) {
    return this.tenders.create(user.tenantId, user.id, id, dto);
  }

  /** Starts the automatic tender sequence based on the lane's carrier preference list. */
  @Post(':id/auto-tender')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  autoTender(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateTenderDto) {
    return this.tenders.autoTender(user.tenantId, user.id, id, dto.expiresInHours);
  }

  @Post(':id/cancel-tender')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  cancelTender(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tenders.cancel(user.tenantId, user.id, id);
  }

  // --- Driver link --------------------------------------------------------------

  @Post(':id/driver-link')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  driverLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.generateDriverLink(user.tenantId, id);
  }

  @Delete(':id/driver-link')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  revokeDriverLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.revokeDriverLink(user.tenantId, id);
  }

  // --- Rating ---------------------------------------------------------------

  /** Replaces the accessorial flags (tailgate, wait…) priced into the load's cost. */
  @Put(':id/accessorials')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  setAccessorials(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetLoadAccessorialsDto,
  ) {
    return this.loads.setAccessorials(user.tenantId, user.id, id, dto);
  }

  /** Rate shopping: ranked candidate rates for this load (read-only decision aid). */
  @Get(':id/rate-options')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_READ)
  rateOptions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rating.rateOptions(user.tenantId, id);
  }

  // --- Bill of Lading -------------------------------------------------------

  /** Generate (or regenerate) a BOL PDF for a dispatched/in-transit/completed load. */
  @Post(':id/bol')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  generateBol(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bol.generate(user.tenantId, user.id, id);
  }

  /** List all BOL documents for a load. */
  @Get(':id/documents')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  listDocuments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bol.listBols(user.tenantId, id);
  }
}
