import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/desk-layout.dto';
import { PreferencesService } from './preferences.service';

@ApiTags('preferences')
@ApiBearerAuth()
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.preferences.get(user.id);
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    const { deskLayout, appearance, releaseNotesSeenAt, moduleTour } = dto;
    return this.preferences.update(user.id, {
      deskLayout,
      appearance,
      moduleTour,
      releaseNotesSeenAt: releaseNotesSeenAt ? new Date(releaseNotesSeenAt) : undefined,
    });
  }
}
