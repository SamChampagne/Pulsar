import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentCenterController } from './document-center.controller';
import { DocumentCenterService } from './document-center.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FILE_STORAGE } from './storage/file-storage';
import { LocalStorageService } from './storage/local-storage.service';
import { S3StorageService } from './storage/s3-storage.service';

@Module({
  controllers: [DocumentCenterController, DocumentsController],
  providers: [
    DocumentsService,
    DocumentCenterService,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('STORAGE_DRIVER', 'local') === 's3'
          ? new S3StorageService(config)
          : new LocalStorageService(config),
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
