import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SaveDocumentCoordinatesDto } from './document-coordinates.dto';
import { DocumentCoordinatesService } from './document-coordinates.service';
const targets = [
  {
    path: 'purchasing/orders',
    kind: 'supplier-order',
    module: MODULE_KEYS.PURCHASING,
    read: PERMISSIONS.PURCHASING.READ,
    manage: PERMISSIONS.PURCHASING.MANAGE,
  },
  {
    path: 'crm/sales-orders',
    kind: 'crm-sales-order',
    module: MODULE_KEYS.CRM,
    read: PERMISSIONS.CRM.READ,
    manage: PERMISSIONS.CRM.MANAGE,
  },
  {
    path: 'services/quotes',
    kind: 'service-quote',
    module: MODULE_KEYS.SERVICES,
    read: PERMISSIONS.SERVICES.READ,
    manage: PERMISSIONS.SERVICES.MANAGE,
  },
  {
    path: 'billing/customer-invoices',
    kind: 'customer-invoice',
    module: MODULE_KEYS.BILLING,
    read: PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    manage: PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE,
  },
  {
    path: 'transportation/transport-orders',
    kind: 'transport-order',
    module: MODULE_KEYS.TRANSPORTATION,
    read: PERMISSIONS.TRANSPORTATION.ORDERS_READ,
    manage: PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE,
  },
] as const;
export const DocumentCoordinatesControllers = targets.map((target) => {
  @ApiTags('document-coordinates')
  @ApiBearerAuth()
  @Controller(`${target.path}/:id/coordinates`)
  @RequireModule(target.module)
  class CoordinatesController {
    constructor(
      @Inject(DocumentCoordinatesService) private readonly service: DocumentCoordinatesService,
    ) {}
    @Get()
    @RequirePermissions(target.read)
    get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      return this.service.get(u.tenantId, target.kind, id);
    }
    @Patch()
    @RequirePermissions(
      target.read,
      target.manage,
      ...(target.kind === 'transport-order' ? [PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ] : []),
    )
    save(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Body() dto: SaveDocumentCoordinatesDto,
    ) {
      return this.service.save(u, target.kind, id, dto);
    }
  }
  Object.defineProperty(CoordinatesController, 'name', {
    value: `Coordinates_${target.kind.replace(/\W/g, '_')}`,
  });
  return CoordinatesController;
});
