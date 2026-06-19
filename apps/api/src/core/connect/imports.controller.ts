import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { ImportsService } from './imports.service';

class ListImportsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  target?: string;
}

@ApiTags('core/connect')
@ApiBearerAuth()
@Controller('connect/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** GET /connect/imports — list all import batches for the current tenant. */
  @Get()
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListImportsQueryDto) {
    return this.imports.list(user.tenantId, query);
  }

  /** GET /connect/imports/targets — available import target catalog. */
  @Get('targets')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_READ)
  targets() {
    return this.imports.getTargets();
  }

  /** GET /connect/imports/:id — batch detail + paginated rows. */
  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_READ)
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListQueryDto,
  ) {
    return this.imports.get(user.tenantId, id, query);
  }

  /**
   * POST /connect/imports — run a CSV import.
   * Multipart fields:
   *   file     — CSV file
   *   target   — import target key (customers | locations | carriers | items | vehicles | trailers)
   *   mapping  — JSON string: { [dtoField]: csvColumnHeader }
   */
  @Post()
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('target') target: string,
    @Body('mapping') mapping: string,
  ) {
    if (!file) {
      throw new BadRequestException('Missing "file" field (multipart/form-data)');
    }
    if (!target) {
      throw new BadRequestException('Missing "target" field');
    }
    if (!mapping) {
      throw new BadRequestException('Missing "mapping" field (JSON string)');
    }
    return this.imports.runImport({ file, target, mapping, user });
  }
}
