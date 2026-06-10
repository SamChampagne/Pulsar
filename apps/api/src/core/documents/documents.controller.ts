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
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentsService } from './documents.service';

class UploadDocumentDto {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;
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

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.remove(user.tenantId, id);
  }
}
