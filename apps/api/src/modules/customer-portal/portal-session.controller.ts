import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PortalAuthUser } from '@pulsar/shared';
import type { Response } from 'express';
import { CurrentPortalUser } from '../../common/decorators/current-portal-user.decorator';
import { PortalController } from '../../common/decorators/portal-controller.decorator';
import {
  CreateOrderTemplateDtoClass,
  PortalChangeRequestDtoClass,
  PortalOrderDto,
  PortalOrdersQueryDto,
  ShipmentCommentDto,
} from './dto/portal.dto';
import { PortalChangeRequestsService } from './portal-change-requests.service';
import { PortalService } from './portal.service';

/**
 * The portal surface for an authenticated customer account — the same payloads
 * as the capability-link routes (`/public/portal/:token/*`), reached through a
 * named session instead of a shared link.
 *
 * Every handler resolves a `PortalContext` from the principal and calls the
 * shared `…For(ctx, …)` core: `tenantId` and `customerId` come from the JWT,
 * never from the URL or the body (rule 1).
 *
 * No `@RequireModule` / `@RequirePermissions` / `@Audit` here on purpose:
 *  - `@PortalController()` is the gate (it re-reads the account, the customer
 *    company and the module activation on every request — rule 15);
 *  - the global permission guard is skipped for `@Public()` routes, and a
 *    permission key would be meaningless for a portal principal (it holds no
 *    tenant role);
 *  - the audit interceptor writes `request.user.id` into `AuditLog.userId`, and
 *    a PortalUser id is not a `User` row — the service audits explicitly with
 *    the portal actor in the payload instead.
 */
@ApiTags('portal')
@ApiBearerAuth()
@PortalController()
@Controller('portal')
export class PortalSessionController {
  constructor(
    private readonly portal: PortalService,
    private readonly changeRequests: PortalChangeRequestsService,
  ) {}

  @Get('view')
  async view(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.getPortalViewFor(await this.portal.contextFromPortalUser(user));
  }

  @Post('orders')
  async createOrder(@CurrentPortalUser() user: PortalAuthUser, @Body() dto: PortalOrderDto) {
    return this.portal.createOrderFor(await this.portal.contextFromPortalUser(user), dto);
  }

  /** Paginated order list (status/search filters) — the `view` keeps the last 50. */
  @Get('orders')
  async listOrders(
    @CurrentPortalUser() user: PortalAuthUser,
    @Query() query: PortalOrdersQueryDto,
  ) {
    return this.portal.listOrdersFor(await this.portal.contextFromPortalUser(user), query);
  }

  @Get('invoices')
  async listInvoices(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listInvoicesFor(await this.portal.contextFromPortalUser(user));
  }

  @Get('invoices/:invoiceId/pdf')
  async downloadInvoicePdf(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ) {
    const ctx = await this.portal.contextFromPortalUser(user);
    const { stream, fileName, mimeType } = await this.portal.downloadInvoicePdfFor(ctx, invoiceId);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    stream.pipe(res);
  }

  /** Tracking detail — same payload as the public tracking page. */
  @Get('shipments/:shipmentId')
  async getShipment(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('shipmentId') shipmentId: string,
  ) {
    return this.portal.getShipmentTrackingFor(
      await this.portal.contextFromPortalUser(user),
      shipmentId,
    );
  }

  @Get('shipments/:shipmentId/documents')
  async listShipmentDocuments(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('shipmentId') shipmentId: string,
  ) {
    return this.portal.listShipmentDocumentsFor(
      await this.portal.contextFromPortalUser(user),
      shipmentId,
    );
  }

  @Get('documents/:documentId/download')
  async downloadDocument(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const ctx = await this.portal.contextFromPortalUser(user);
    const { stream, fileName, mimeType } = await this.portal.downloadShipmentDocumentFor(
      ctx,
      documentId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    stream.pipe(res);
  }

  @Get('templates')
  async listTemplates(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listTemplatesFor(await this.portal.contextFromPortalUser(user));
  }

  @Post('templates')
  async createTemplate(
    @CurrentPortalUser() user: PortalAuthUser,
    @Body() dto: CreateOrderTemplateDtoClass,
  ) {
    return this.portal.createTemplateFor(await this.portal.contextFromPortalUser(user), dto);
  }

  @Delete('templates/:id')
  async deleteTemplate(@CurrentPortalUser() user: PortalAuthUser, @Param('id') id: string) {
    return this.portal.deleteTemplateFor(await this.portal.contextFromPortalUser(user), id);
  }

  @Get('change-requests')
  async listChangeRequests(@CurrentPortalUser() user: PortalAuthUser) {
    return this.changeRequests.listFor(await this.portal.contextFromPortalUser(user));
  }

  @Post('change-requests')
  async createChangeRequest(
    @CurrentPortalUser() user: PortalAuthUser,
    @Body() dto: PortalChangeRequestDtoClass,
  ) {
    return this.changeRequests.createFor(await this.portal.contextFromPortalUser(user), dto);
  }

  @Get('shipments/:shipmentId/comments')
  async listShipmentComments(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('shipmentId') shipmentId: string,
  ) {
    return this.portal.listShipmentCommentsFor(
      await this.portal.contextFromPortalUser(user),
      shipmentId,
    );
  }

  @Post('shipments/:shipmentId/comments')
  async createShipmentComment(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ShipmentCommentDto,
  ) {
    return this.portal.createShipmentCommentFor(
      await this.portal.contextFromPortalUser(user),
      shipmentId,
      dto.body,
    );
  }
}
