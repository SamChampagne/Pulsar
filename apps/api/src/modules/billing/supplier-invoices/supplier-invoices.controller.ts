import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierInvoiceEvidenceService } from './supplier-invoice-evidence.service';
import {
  SupplierInvoiceDto,
  SupplierInvoiceCloseDto,
  SupplierInvoiceEvidenceDto,
} from './supplier-invoices.dto';
const READ = 'billing.supplier-invoices.read',
  MANAGE = 'billing.supplier-invoices.manage',
  QUALIFY = 'billing.supplier-invoices.qualify';
@ApiTags('billing/supplier-invoices')
@ApiBearerAuth()
@RequireModule('billing')
@Controller('billing/supplier-invoices')
export class SupplierInvoicesController {
  constructor(
    private readonly service: SupplierInvoicesService,
    private readonly files: SupplierInvoiceEvidenceService,
  ) {}
  @Get() @RequirePermissions(READ) list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.service.list(u, q);
  }
  @Get('sources/:supplierId') @RequirePermissions(READ, 'purchasing.read') sources(
    @CurrentUser() u: AuthUser,
    @Param('supplierId') id: string,
    @Query() q: ListQueryDto,
  ) {
    return this.service.sources(u, id, q);
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
  @Post() @RequirePermissions(READ, MANAGE) create(
    @CurrentUser() u: AuthUser,
    @Body() d: SupplierInvoiceDto,
  ) {
    return this.service.save(u, null, d);
  }
  @Put(':id') @RequirePermissions(READ, MANAGE) update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierInvoiceDto,
  ) {
    return this.service.save(u, id, d);
  }
  @Post(':id/qualify') @RequirePermissions(READ, QUALIFY) qualify(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierInvoiceCloseDto,
  ) {
    return this.service.close(u, id, 'QUALIFIED', d);
  }
  @Post(':id/cancel') @RequirePermissions(READ, MANAGE) cancel(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierInvoiceCloseDto,
  ) {
    return this.service.close(u, id, 'CANCELLED', d);
  }
  @Get(':id/evidence') @RequirePermissions(READ) evidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.files.list(u.tenantId, id);
  }
  @Get(':id/evidence/requests/:key') @RequirePermissions(READ, MANAGE) evidenceRequest(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.files.request(u, id, key);
  }
  @Post(':id/evidence')
  @RequirePermissions(READ, MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: SupplierInvoiceEvidenceDto,
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
    const d = await this.files.download(u.tenantId, id, evidenceId);
    return new StreamableFile(d.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
    });
  }
}
