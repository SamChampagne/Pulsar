import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsInt, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentsService } from './documents.service';

class RegisterDocumentDto {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

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

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDocumentDto) {
    return this.documents.register(user.tenantId, { ...dto, uploadedById: user.id });
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.remove(user.tenantId, id);
  }
}
