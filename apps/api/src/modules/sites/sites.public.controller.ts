import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SitesPublicService } from './sites.public.service';
import { SubmitDto } from './dto/submit.dto';

/**
 * Public landing page controller — no auth, no ModulesGuard.
 * Module activation + PUBLISHED gate are enforced inside SitesPublicService (R15).
 * Projection is enforced inside SitesPublicService (R10 — never exposes tenantId/id/captureListId).
 */
@ApiTags('public')
@Public()
@Controller('public/sites')
export class SitesPublicController {
  constructor(private readonly service: SitesPublicService) {}

  /** GET /public/sites/:slug — display-safe page view ({ title, blocks }). */
  @Get(':slug')
  getPublic(@Param('slug') slug: string) {
    return this.service.getPublic(slug);
  }

  /** POST /public/sites/:slug/submit — submit a form (lead capture). */
  @Post(':slug/submit')
  submit(@Param('slug') slug: string, @Body() dto: SubmitDto) {
    return this.service.submit(slug, dto);
  }
}
