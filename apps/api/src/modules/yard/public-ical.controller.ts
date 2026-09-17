import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { YardIcalService } from './ical/ical.service';

/**
 * Public dock-appointment calendar feed — no auth, no ModulesGuard.
 * Module activation is re-checked inside YardIcalService (rule 15); the
 * payload is a display-only projection built by buildIcs (rule 10 — never
 * tenantId/internal ids, no history, no geometry).
 *
 * The opaque token in the URL is the credential, so ThrottlerGuard caps brute
 * force exactly like the inbound webhook door; the token is redacted from the
 * request log (`TOKEN_PATH_PREFIXES`).
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/ical/yard')
export class YardPublicIcalController {
  constructor(private readonly ical: YardIcalService) {}

  @Get(':token')
  async feed(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const ics = await this.ical.buildFeed(token);
    res
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="yard.ics"')
      .send(ics);
  }
}
