import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CarrierPortalService } from './carrier-portal.service';

class DeclineTenderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Public, token-authenticated carrier portal endpoints — no JWT, no module/permission guard.
 * The carrier portal token in the URL is the sole credential; every handler revalidates it
 * via CarrierPortalService.carrierByToken (module gate re-checked — rule 15).
 * Payloads never expose tenantId/carrierId (rule 10); entity ids for the carrier's own
 * tenders/loads/invoices are exposed so the portal can act on them (token-scoped).
 */
@ApiTags('public')
@Public()
@Controller('public/carrier-portal')
export class CarrierPortalPublicController {
  constructor(private readonly carrierPortal: CarrierPortalService) {}

  /** Read-only view: carrier profile, active tenders, loads, and invoices. */
  @Get(':token')
  getView(@Param('token') token: string) {
    return this.carrierPortal.getView(token);
  }

  /** Accept a tender from the carrier portal. */
  @Post(':token/tenders/:tenderId/accept')
  @HttpCode(200)
  acceptTender(
    @Param('token') token: string,
    @Param('tenderId') tenderId: string,
  ) {
    return this.carrierPortal.respondTender(token, tenderId, true);
  }

  /** Decline a tender from the carrier portal (optional decline reason). */
  @Post(':token/tenders/:tenderId/decline')
  @HttpCode(200)
  declineTender(
    @Param('token') token: string,
    @Param('tenderId') tenderId: string,
    @Body() dto: DeclineTenderDto,
  ) {
    return this.carrierPortal.respondTender(token, tenderId, false, dto.reason);
  }

  /** Upload a proof-of-delivery document for a load. Multipart/form-data, field "file". */
  @Post(':token/loads/:loadId/pod')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  uploadPod(
    @Param('token') token: string,
    @Param('loadId') loadId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.carrierPortal.uploadPod(token, loadId, file);
  }

  /** Upload a supporting attachment for an incoming carrier invoice. Multipart, field "file". */
  @Post(':token/invoices/:invoiceId/attachment')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  uploadInvoiceAttachment(
    @Param('token') token: string,
    @Param('invoiceId') invoiceId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.carrierPortal.uploadInvoiceAttachment(token, invoiceId, file);
  }
}
