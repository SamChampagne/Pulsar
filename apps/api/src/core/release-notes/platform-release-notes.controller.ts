import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformController } from '../../common/decorators/platform-controller.decorator';
import { CreateReleaseNoteDto, UpdateReleaseNoteDto } from './dto/release-note.dto';
import { ReleaseNotesService } from './release-notes.service';

interface PlatformRequest {
  user: { id: string; email: string };
}

/**
 * Platform plane: authoring the "what's new" feed. @PlatformController() skips
 * the tenant JwtAuthGuard (@Public) and enforces the platform JWT (PlatformGuard).
 */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformController()
@Controller('platform/release-notes')
export class PlatformReleaseNotesController {
  constructor(private readonly releaseNotes: ReleaseNotesService) {}

  @Get()
  list() {
    return this.releaseNotes.listAll();
  }

  @Post()
  create(@Req() req: PlatformRequest, @Body() dto: CreateReleaseNoteDto) {
    return this.releaseNotes.create(req.user.email, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReleaseNoteDto) {
    return this.releaseNotes.update(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.releaseNotes.publish(id);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.releaseNotes.unpublish(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.releaseNotes.remove(id);
  }
}
