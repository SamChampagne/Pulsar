import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CatalogDetailsService } from './catalog-details.service';
import { BusinessService } from './business.service';
import {
  SaveCatalogDetailsDto,
  SaveSupplierOfferDto,
  SupplierOffersQueryDto,
} from './catalog-details.dto';

const accesses = [
  { module: 'catalog', path: 'catalog/items' },
  { module: 'services', path: 'services/data/items' },
  { module: 'purchasing', path: 'purchasing/data/items' },
] as const;
export const CatalogDetailsControllers = accesses.map((a) => {
  @ApiTags('catalog-details')
  @ApiBearerAuth()
  @RequireModule(a.module)
  @Controller(`${a.path}/:id/details`)
  class DetailsController {
    constructor(@Inject(CatalogDetailsService) private readonly service: CatalogDetailsService) {}
    @Get()
    @RequirePermissions(`${a.module}.read`)
    get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      return this.service.get(u.tenantId, id);
    }
    @Put()
    @RequirePermissions(`${a.module}.read`, `${a.module}.manage`)
    @Audit('catalog-item-details', AuditAction.UPDATE)
    save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: SaveCatalogDetailsDto) {
      return this.service.save(u.tenantId, id, d.expectedVersion, d.data);
    }
  }
  Object.defineProperty(DetailsController, 'name', { value: `CatalogDetails_${a.module}` });
  return DetailsController;
});
// Purchase costs are NOT available through Services readers or agent item summaries.
export const CatalogOfferControllers = accesses
  .filter((a) => a.module !== 'services')
  .map((a) => {
    @ApiTags('catalog-offers')
    @ApiBearerAuth()
    @RequireModule(a.module)
    @Controller(`${a.path}/:id/supplier-offers`)
    class OffersController {
      constructor(
        @Inject(CatalogDetailsService) private readonly service: CatalogDetailsService,
        @Inject(BusinessService) private readonly business: BusinessService,
      ) {}
      @Get('suppliers')
      @RequirePermissions(`${a.module}.read`)
      suppliers(@CurrentUser() u: AuthUser, @Query() q: SupplierOffersQueryDto) {
        return this.business.partners(u.tenantId, q, 'isSupplier');
      }
      @Get()
      @RequirePermissions(`${a.module}.read`)
      get(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: SupplierOffersQueryDto) {
        return this.service.offers(u.tenantId, id, q);
      }
      @Put()
      @RequirePermissions(`${a.module}.read`, `${a.module}.manage`)
      @Audit('catalog-supplier-offer', AuditAction.UPDATE)
      save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: SaveSupplierOfferDto) {
        return this.service.saveOffer(u.tenantId, id, d);
      }
    }
    Object.defineProperty(OffersController, 'name', { value: `CatalogOffers_${a.module}` });
    return OffersController;
  });
