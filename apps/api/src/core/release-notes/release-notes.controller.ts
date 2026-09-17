import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { ReleaseNotesService } from './release-notes.service';

/**
 * Tenant plane: any authenticated user reads the published feed and marks it
 * seen — no extra permission (mirrors notifications.controller.ts).
 */
@ApiTags('core/release-notes')
@ApiBearerAuth()
@Controller('release-notes')
export class ReleaseNotesController {
  constructor(private readonly releaseNotes: ReleaseNotesService) {}

  @Get()
  list(@Query() query: ListQueryDto) {
    return this.releaseNotes.listPublished(query);
  }

  @Get('unseen-count')
  unseenCount(@CurrentUser() user: AuthUser) {
    return this.releaseNotes.unseenCount(user.id);
  }

  @Post('seen')
  @HttpCode(200)
  markSeen(@CurrentUser() user: AuthUser) {
    return this.releaseNotes.markSeen(user.id);
  }
}
