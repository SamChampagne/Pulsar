import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { LedgerQualificationService } from './ledger-qualification.service';
import { LedgerCurrencyEvidenceService } from './ledger-currency-evidence.service';
import {
  LedgerQualificationReviewDto,
  LedgerQualificationConfirmDto,
  LedgerEvidenceDto,
} from './ledger-qualification.dto';
const READ = 'billing.ledger.read',
  QUALIFY = 'billing.ledger.qualify';
@ApiTags('billing/ledger-qualification')
@ApiBearerAuth()
@RequireModule('billing')
@Controller('billing/ledger-qualification')
export class LedgerQualificationController {
  constructor(
    private readonly service: LedgerQualificationService,
    private readonly files: LedgerCurrencyEvidenceService,
  ) {}
  @Get() @RequirePermissions(READ) list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.service.list(u, q);
  }
  @Get('requests/:key') @RequirePermissions(READ) request(
    @CurrentUser() u: AuthUser,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.service.request(u, key);
  }
  @Get(':id') @RequirePermissions(READ) get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(u, id);
  }
  @Post(':id/review') @RequirePermissions(READ, QUALIFY) review(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: LedgerQualificationReviewDto,
  ) {
    return this.service.review(u, id, d);
  }
  @Post(':id/confirm') @RequirePermissions(READ, QUALIFY) confirm(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: LedgerQualificationConfirmDto,
  ) {
    return this.service.confirm(u, id, d);
  }
  @Get(':id/evidence') @RequirePermissions(READ) evidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.files.list(u, id);
  }
  @Get(':id/evidence/requests/:key') @RequirePermissions(READ, QUALIFY) evidenceRequest(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.files.request(u, id, key);
  }
  @Post(':id/evidence')
  @RequirePermissions(READ, QUALIFY)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: LedgerEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.files.upload(u, id, d, file);
  }
  @Get(':id/evidence/:evidenceId/download')
  @RequirePermissions(READ)
  async download(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    const d = await this.files.download(u, id, evidenceId);
    return new StreamableFile(d.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
    });
  }
}
