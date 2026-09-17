import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { InboundHooksService } from './inbound-hooks.service';

/**
 * Public inbound webhook door. `@Public()` bypasses the tenant JwtAuthGuard —
 * the opaque token in the URL is the credential (hashed at rest) — and
 * ThrottlerGuard caps brute force, exactly like the portal auth door.
 *
 * Excluded from Swagger on purpose: the surface is documented for partners in
 * docs/collaboration.md and must not advertise tenant receivers.
 */
@ApiExcludeController()
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/hooks')
export class InboundHooksController {
  constructor(private readonly hooks: InboundHooksService) {}

  /**
   * 202 for a delivery this call processed (`status` says whether the business
   * write succeeded), 200 for a delivery already processed under the same
   * idempotency key (`replayed: true`, nothing re-executed).
   */
  @Post(':inboundToken')
  @HttpCode(202)
  async receive(
    @Param('inboundToken') inboundToken: string,
    @Req() req: RawBodyRequest<Request>,
    // `unknown`: a JSON receiver gets an object, an EDI one the raw interchange
    // string (parsed by the ConnectModule `rawTextBody` middleware).
    @Body() body: unknown,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.hooks.receive({
      token: inboundToken,
      body,
      rawBody: req.rawBody,
      signature,
      idempotencyKey,
    });
    if (result.replayed) res.status(200);
    return result;
  }
}
