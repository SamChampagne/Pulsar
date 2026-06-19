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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InboundService, ListInboxQueryDto } from './inbound.service';

@ApiTags('core/connect')
@ApiBearerAuth()
@Controller('connect')
export class InboundController {
  constructor(private readonly inbound: InboundService) {}

  /**
   * POST /connect/inbound/carrier-invoice
   * Multipart: file (PDF) + carrierId + carrierInvoiceNumber + currency? + lines (JSON string).
   * Requires core.connect.manage AND billing.freight-audit.manage (checked in service, rule 15).
   */
  @Post('inbound/carrier-invoice')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async ingestCarrierInvoice(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('carrierId') carrierId: string,
    @Body('carrierInvoiceNumber') carrierInvoiceNumber: string,
    @Body('currency') currency: string | undefined,
    @Body('lines') lines: string,
  ) {
    if (!file) {
      throw new BadRequestException('Missing "file" field (multipart/form-data)');
    }
    if (!carrierId) {
      throw new BadRequestException('Missing "carrierId" field');
    }
    if (!carrierInvoiceNumber) {
      throw new BadRequestException('Missing "carrierInvoiceNumber" field');
    }
    if (!lines) {
      throw new BadRequestException('Missing "lines" field (JSON string)');
    }
    return this.inbound.ingestCarrierInvoice(user, file, {
      carrierId,
      carrierInvoiceNumber,
      currency,
      lines,
    });
  }

  /**
   * POST /connect/inbound/document
   * Multipart: file + refType + refId + kind?.
   */
  @Post('inbound/document')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async ingestDocument(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('refType') refType: string,
    @Body('refId') refId: string,
    @Body('kind') kind: string | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing "file" field (multipart/form-data)');
    }
    if (!refType) {
      throw new BadRequestException('Missing "refType" field');
    }
    if (!refId) {
      throw new BadRequestException('Missing "refId" field');
    }
    return this.inbound.ingestDocument(user, file, { refType, refId, kind });
  }

  /**
   * GET /connect/inbox
   * List inbound messages (newest first, paginated). Optional filters: source, status.
   */
  @Get('inbox')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_READ)
  listInbox(@CurrentUser() user: AuthUser, @Query() query: ListInboxQueryDto) {
    return this.inbound.listInbox(user.tenantId, query);
  }

  /**
   * GET /connect/inbox/:id
   * Message detail + document URL (best-effort).
   */
  @Get('inbox/:id')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_READ)
  getInboxMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbound.getInboxMessage(user.tenantId, id);
  }

  /**
   * POST /connect/inbox/:id/ignore
   * Set status to IGNORED (tenant-scoped conditional update).
   */
  @Post('inbox/:id/ignore')
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_MANAGE)
  ignoreMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbound.ignoreMessage(user.tenantId, user.id, id);
  }
}
