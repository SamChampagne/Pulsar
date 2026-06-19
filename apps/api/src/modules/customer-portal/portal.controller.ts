import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, TransportMode } from '@pulsar/shared';
import {
  IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Min,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PortalService } from './portal.service';
import type { CreateOrderTemplateInput, PortalChangeRequestInput } from './portal.service';

class PortalOrderDto {
  @IsOptional()
  @IsString()
  originLocationId?: string;

  @IsOptional()
  @IsString()
  destinationLocationId?: string;

  @IsOptional()
  @IsString()
  customerReference?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupLate?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryLate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @IsOptional()
  @IsString()
  templateId?: string;
}

class CreateOrderTemplateDtoClass implements CreateOrderTemplateInput {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  originLocationId?: string;

  @IsOptional()
  @IsString()
  destinationLocationId?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalVolumeM3?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PortalChangeRequestDtoClass implements PortalChangeRequestInput {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsIn(['DATE', 'ADDRESS', 'CANCEL', 'OTHER'])
  kind!: string;

  @IsString()
  note!: string;
}

class SetBrandingDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, { message: 'accentColor must be a hex color (e.g. #RRGGBB)' })
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

  @Put('branding')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE)
  setBranding(@CurrentUser() user: AuthUser, @Body() dto: SetBrandingDto) {
    return this.portal.setBranding(user.tenantId, dto);
  }
}

/** Public, token-authenticated portal view (module gate enforced in the service). */
@ApiTags('public')
@Public()
@Controller('public/portal')
export class PortalPublicController {
  constructor(private readonly portal: PortalService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.portal.getPortalView(token);
  }

  /** Portal v2: the customer submits a transport request (lands as a DRAFT order). */
  @Post(':token/orders')
  createOrder(@Param('token') token: string, @Body() dto: PortalOrderDto) {
    return this.portal.createOrder(token, dto);
  }

  @Get(':token/invoices')
  listInvoices(@Param('token') token: string) {
    return this.portal.listInvoices(token);
  }

  @Get(':token/shipments/:shipmentId/documents')
  listShipmentDocuments(
    @Param('token') token: string,
    @Param('shipmentId') shipmentId: string,
  ) {
    return this.portal.listShipmentDocuments(token, shipmentId);
  }

  @Get(':token/documents/:documentId/download')
  async downloadDocument(
    @Param('token') token: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType } = await this.portal.downloadShipmentDocument(token, documentId);
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
  createTemplate(
    @Param('token') token: string,
    @Body() dto: CreateOrderTemplateDtoClass,
  ) {
    return this.portal.createTemplate(token, dto);
  }

  @Delete(':token/templates/:id')
  deleteTemplate(
    @Param('token') token: string,
    @Param('id') id: string,
  ) {
    return this.portal.deleteTemplate(token, id);
  }

  @Post(':token/change-requests')
  createChangeRequest(
    @Param('token') token: string,
    @Body() dto: PortalChangeRequestDtoClass,
  ) {
    return this.portal.createChangeRequest(token, dto);
  }
}
