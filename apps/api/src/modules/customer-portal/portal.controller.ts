import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, TransportMode } from '@pulsar/shared';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PortalService } from './portal.service';

class PortalOrderDto {
  @IsString()
  originLocationId!: string;

  @IsString()
  destinationLocationId!: string;

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
}
