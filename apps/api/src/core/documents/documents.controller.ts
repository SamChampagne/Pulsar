import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsInt, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentsService } from './documents.service';

class UploadDocumentDto {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;
}

class PresignUploadDto extends UploadDocumentDto {
  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;
}

class ConfirmUploadDto extends PresignUploadDto {
  @IsString()
  storageKey!: string;

  @IsInt()
  @Min(0)
  sizeBytes!: number;
}

@ApiTags('core/documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_READ)
  list(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.documents.listForEntity(user.tenantId, entityType, entityId);
  }

  @Post('upload')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.documents.upload(user.tenantId, {
      entityType: dto.entityType,
      entityId: dto.entityId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
      uploadedById: user.id,
    });
  }

  @Get(':id/download')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_READ)
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { stream, fileName, mimeType } = await this.documents.download(user.tenantId, id);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
  }

  @Get(':id/download-url')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_READ)
  downloadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.downloadUrl(user.tenantId, id);
  }

  /** Direct-to-S3 upload, step 1: get a pre-signed PUT URL (s3 driver only). */
  @Post('presign-upload')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  presignUpload(@CurrentUser() user: AuthUser, @Body() dto: PresignUploadDto) {
    return this.documents.presignUpload(user.tenantId, dto);
  }

  /** Direct-to-S3 upload, step 2: register the uploaded file as a document. */
  @Post('confirm-upload')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  confirmUpload(@CurrentUser() user: AuthUser, @Body() dto: ConfirmUploadDto) {
    return this.documents.confirmUpload(user.tenantId, { ...dto, uploadedById: user.id });
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.remove(user.tenantId, id);
  }
}
