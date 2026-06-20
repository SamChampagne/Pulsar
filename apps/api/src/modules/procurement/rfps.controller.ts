import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, BidStatus, MODULE_KEYS, PERMISSIONS, RfpStatus } from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AddLaneDto } from './dto/add-lane.dto';
import { AwardDto } from './dto/award.dto';
import { CreateRfpDto } from './dto/create-rfp.dto';
import { InviteDto } from './dto/invite.dto';
import { UpdateRfpDto } from './dto/update-rfp.dto';
import { ProcurementService } from './procurement.service';

class RfpListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}

@ApiTags('procurement')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.PROCUREMENT)
@Controller('procurement')
export class RfpsController {
  constructor(private readonly procurement: ProcurementService) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------

  @Get('rfps')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.READ)
  listRfps(@CurrentUser() user: AuthUser, @Query() query: RfpListQueryDto) {
    return this.procurement.listRfps(user.tenantId, query);
  }

  @Get('routing-guide')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.READ)
  routingGuide(@CurrentUser() user: AuthUser) {
    return this.procurement.routingGuide(user.tenantId);
  }

  @Get('rfps/:id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.READ)
  getRfp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.getRfp(user.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // RFP CRUD
  // ---------------------------------------------------------------------------

  @Post('rfps')
  @Audit('rfp', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  createRfp(@CurrentUser() user: AuthUser, @Body() dto: CreateRfpDto) {
    return this.procurement.createRfp(user.tenantId, user.id, dto);
  }

  @Patch('rfps/:id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  updateRfp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRfpDto) {
    return this.procurement.updateRfp(user.tenantId, id, dto);
  }

  // ---------------------------------------------------------------------------
  // Lanes
  // ---------------------------------------------------------------------------

  @Post('rfps/:id/lanes')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  addLane(@CurrentUser() user: AuthUser, @Param('id') rfpId: string, @Body() dto: AddLaneDto) {
    return this.procurement.addLane(user.tenantId, rfpId, dto);
  }

  @Delete('rfps/:id/lanes/:rfpLaneId')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  removeLane(
    @CurrentUser() user: AuthUser,
    @Param('id') rfpId: string,
    @Param('rfpLaneId') rfpLaneId: string,
  ) {
    return this.procurement.removeLane(user.tenantId, rfpId, rfpLaneId);
  }

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  @Post('rfps/:id/invites')
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  invite(@CurrentUser() user: AuthUser, @Param('id') rfpId: string, @Body() dto: InviteDto) {
    return this.procurement.invite(user.tenantId, rfpId, dto);
  }

  // ---------------------------------------------------------------------------
  // RFP Transitions
  // ---------------------------------------------------------------------------

  @Post('rfps/:id/open')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  openRfp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.transitionRfp(user.tenantId, id, RfpStatus.OPEN, user.id);
  }

  @Post('rfps/:id/evaluation')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  evaluationRfp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.transitionRfp(user.tenantId, id, RfpStatus.EVALUATION, user.id);
  }

  @Post('rfps/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  cancelRfp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.transitionRfp(user.tenantId, id, RfpStatus.CANCELLED, user.id);
  }

  // ---------------------------------------------------------------------------
  // Bid Transitions
  // ---------------------------------------------------------------------------

  @Post('rfps/:id/bids/:bidId/shortlist')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  shortlistBid(
    @CurrentUser() user: AuthUser,
    @Param('id') rfpId: string,
    @Param('bidId') bidId: string,
  ) {
    return this.procurement.transitionBid(
      user.tenantId,
      rfpId,
      bidId,
      BidStatus.SHORTLISTED,
      user.id,
    );
  }

  @Post('rfps/:id/bids/:bidId/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  rejectBid(
    @CurrentUser() user: AuthUser,
    @Param('id') rfpId: string,
    @Param('bidId') bidId: string,
  ) {
    return this.procurement.transitionBid(
      user.tenantId,
      rfpId,
      bidId,
      BidStatus.REJECTED,
      user.id,
    );
  }

  // ---------------------------------------------------------------------------
  // Award
  // ---------------------------------------------------------------------------

  @Post('rfps/:id/award')
  @Audit('rfp-award', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.PROCUREMENT.MANAGE)
  award(@CurrentUser() user: AuthUser, @Param('id') rfpId: string, @Body() dto: AwardDto) {
    return this.procurement.award(user.tenantId, user.id, rfpId, dto);
  }
}
