import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { StockExitEvidenceService } from './stock-exit-evidence.service';
import { StockExitEvidenceDto } from './stock-exits.dto';
@ApiTags('wms/stock-exits')
@ApiBearerAuth()
@RequireModule('wms')
@Controller('wms/stock-exits/:id/evidence')
export class StockExitEvidenceController {
  constructor(private readonly service: StockExitEvidenceService) {}
  @Get() @RequirePermissions('wms.read') list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.list(u.tenantId, id);
  }
  @Get('requests/:key') @RequirePermissions('wms.read', 'wms.manage') request(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.service.request(u, id, key);
  }
  @Post()
  @RequirePermissions('wms.read', 'wms.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: StockExitEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.upload(u, id, d, file);
  }
  @Get(':evidenceId/download')
  @RequirePermissions('wms.read')
  async download(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    const d = await this.service.download(u.tenantId, id, evidenceId);
    return new StreamableFile(d.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
    });
  }
}
