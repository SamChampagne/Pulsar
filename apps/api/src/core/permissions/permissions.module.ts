import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { PermissionsSyncService } from './permissions-sync.service';

@Module({
  controllers: [PermissionsController],
  providers: [PermissionsSyncService],
  exports: [PermissionsSyncService],
})
export class PermissionsModule {}
