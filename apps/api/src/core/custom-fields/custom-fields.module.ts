import { Module } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service';

@Module({ providers: [CustomFieldsService], exports: [CustomFieldsService] })
export class CustomFieldsModule {}
