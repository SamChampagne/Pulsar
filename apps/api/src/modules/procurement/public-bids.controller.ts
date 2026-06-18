import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ProcurementService } from './procurement.service';
import { SubmitBidDto } from './dto/submit-bid.dto';

/**
 * Token-authenticated public endpoints for carrier bid submission.
 * No JWT — the token in the URL is the credential.
 * Rule-10: public projection only (no tenantId, no internal ids beyond rfpLaneId).
 * Rule-15: module activation is rechecked inside the service for every request.
 */
@ApiTags('public/procurement')
@Public()
@Controller('public/rfp-invites')
export class PublicBidsController {
  constructor(private readonly procurement: ProcurementService) {}

  /**
   * GET /public/rfp-invites/:token
   * Returns safe public projection: rfp details + lanes summary.
   * No tenantId, no internal ids except rfpLaneId (needed for bid submission).
   */
  @Get(':token')
  getInvite(@Param('token') token: string) {
    return this.procurement.getInviteByToken(token);
  }

  /**
   * POST /public/rfp-invites/:token/bids
   * Carrier submits a bid for a specific lane in the RFP.
   * Returns { ok: true } only — no internal state exposed.
   */
  @Post(':token/bids')
  @HttpCode(201)
  submitBid(@Param('token') token: string, @Body() dto: SubmitBidDto) {
    return this.procurement.submitBidByToken(token, dto);
  }
}
