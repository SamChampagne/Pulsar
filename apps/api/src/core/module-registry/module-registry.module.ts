import { Module } from '@nestjs/common';
import { ModuleRegistryController } from './module-registry.controller';
import { ModuleRegistryService } from './module-registry.service';
import { ModuleSettingsService } from './module-settings.service';

@Module({
  controllers: [ModuleRegistryController],
  providers: [ModuleRegistryService, ModuleSettingsService],
  exports: [ModuleRegistryService, ModuleSettingsService],
})
export class ModuleRegistryModule {}
