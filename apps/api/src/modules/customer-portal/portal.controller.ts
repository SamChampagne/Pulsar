import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsOptional, IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateOrderTemplateDtoClass,
  PortalChangeRequestDtoClass,
  PortalOrderDto,
  PortalOrdersQueryDto,
  ShipmentCommentDto,
} from './dto/portal.dto';
import { PortalChangeRequestsService } from './portal-change-requests.service';
import { PortalService } from './portal.service';

class SetBrandingDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, {
    message: 'accentColor must be a hex color (e.g. #RRGGBB)',
  })
  accentColor?: string;
}

/** Link management — gated on the customer-portal module being enabled for the tenant. */
@ApiTags('customer-portal')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)
@Controller('customer-portal/customers')
export class PortalLinksController {
  constructor(private readonly portal: PortalService) {}

  @Post(':customerId/portal-link')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  generate(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.portal.generateLink(user.tenantId, customerId);
  }

  @Delete(':customerId/portal-link')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.portal.revokeLink(user.tenantId, customerId);
  }
}

/** Admin branding management — gated on the customer-portal module being enabled for the tenant. */
@ApiTags('customer-portal')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)
@Controller('customer-portal')
export class PortalAdminController {
  constructor(private readonly portal: PortalService) {}

  @Get('branding')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  getBranding(@CurrentUser() user: AuthUser) {
    return this.portal.getBranding(user.tenantId);
  }

  @Post('branding/logo')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Sélectionnez une image PNG, JPEG ou WebP.');
    return this.portal.uploadLogo(user.tenantId, user.id, file);
  }

  @Put('branding')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  setBranding(@CurrentUser() user: AuthUser, @Body() dto: SetBrandingDto) {
    return this.portal.setBranding(user.tenantId, dto, user.id);
  }
}

/** Public, token-authenticated portal view (module gate enforced in the service). */
@ApiTags('public')
@Public()
@Controller('public/portal')
export class PortalPublicController {
  constructor(
    private readonly portal: PortalService,
    private readonly changeRequests: PortalChangeRequestsService,
  ) {}

  @Get('branding/logo/:token')
  async logo(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const { stream, mimeType } = await this.portal.getLogo(token);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(stream, { type: mimeType, disposition: 'inline' });
  }

  @Get(':token')
  view(@Param('token') token: string) {
    return this.portal.getPortalView(token);
  }

  /** Portal v2: the customer submits a transport request (lands as a DRAFT order). */
  @Post(':token/orders')
  createOrder(@Param('token') token: string, @Body() dto: PortalOrderDto) {
    return this.portal.createOrder(token, dto);
  }

  /** Token twin of `GET /portal/orders` — same payload, same scoping. */
  @Get(':token/orders')
  listOrders(@Param('token') token: string, @Query() query: PortalOrdersQueryDto) {
    return this.portal.listOrders(token, query);
  }

  @Get(':token/shipments/:shipmentId')
  getShipment(@Param('token') token: string, @Param('shipmentId') shipmentId: string) {
    return this.portal.getShipmentTracking(token, shipmentId);
  }

  @Get(':token/invoices')
  listInvoices(@Param('token') token: string) {
    return this.portal.listInvoices(token);
  }

  @Get(':token/invoices/:invoiceId/pdf')
  async downloadInvoicePdf(
    @Param('token') token: string,
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType } = await this.portal.downloadInvoicePdf(token, invoiceId);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    stream.pipe(res);
  }

  @Get(':token/shipments/:shipmentId/documents')
  listShipmentDocuments(@Param('token') token: string, @Param('shipmentId') shipmentId: string) {
    return this.portal.listShipmentDocuments(token, shipmentId);
  }

  @Get(':token/documents/:documentId/download')
  async downloadDocument(
    @Param('token') token: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType } = await this.portal.downloadShipmentDocument(
      token,
      documentId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    stream.pipe(res);
  }

  @Get(':token/templates')
  listTemplates(@Param('token') token: string) {
    return this.portal.listTemplates(token);
  }

  @Post(':token/templates')
  createTemplate(@Param('token') token: string, @Body() dto: CreateOrderTemplateDtoClass) {
    return this.portal.createTemplate(token, dto);
  }

  @Delete(':token/templates/:id')
  deleteTemplate(@Param('token') token: string, @Param('id') id: string) {
    return this.portal.deleteTemplate(token, id);
  }

  @Get(':token/change-requests')
  async listChangeRequests(@Param('token') token: string) {
    return this.changeRequests.listFor(await this.portal.contextFromToken(token));
  }

  @Post(':token/change-requests')
  async createChangeRequest(
    @Param('token') token: string,
    @Body() dto: PortalChangeRequestDtoClass,
  ) {
    return this.changeRequests.createFor(await this.portal.contextFromToken(token), dto);
  }

  @Get(':token/shipments/:shipmentId/comments')
  listShipmentComments(@Param('token') token: string, @Param('shipmentId') shipmentId: string) {
    return this.portal.listShipmentComments(token, shipmentId);
  }

  @Post(':token/shipments/:shipmentId/comments')
  createShipmentComment(
    @Param('token') token: string,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ShipmentCommentDto,
  ) {
    return this.portal.createShipmentComment(token, shipmentId, dto.body);
  }
}
