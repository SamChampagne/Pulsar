import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { YardIcalService } from './ical/ical.service';

/**
 * Public dock-appointment calendar feed — no auth, no ModulesGuard.
 * Module activation is re-checked inside YardIcalService (rule 15); the
 * payload is a display-only projection built by buildIcs (rule 10 — never
 * tenantId/internal ids, no history, no geometry).
 */
@ApiTags('public')
@Public()
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
