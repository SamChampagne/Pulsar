import { Module } from '@nestjs/common';
import { PreferencesModule } from '../preferences/preferences.module';
import { PlatformReleaseNotesController } from './platform-release-notes.controller';
import { ReleaseNotesController } from './release-notes.controller';
import { ReleaseNotesService } from './release-notes.service';

@Module({
  imports: [PreferencesModule],
  controllers: [ReleaseNotesController, PlatformReleaseNotesController],
  providers: [ReleaseNotesService],
})
export class ReleaseNotesModule {}
