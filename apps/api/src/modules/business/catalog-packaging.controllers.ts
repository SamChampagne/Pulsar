import { Body, Controller, Get, Inject, Param, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { CatalogPackagingService } from './catalog-packaging.service';
import {
  CreateCatalogPackageDto,
  UpdateCatalogPackageDto,
  ResolvePackageDto,
} from './catalog-packaging.dto';
export const CatalogPackagingControllers = (
  [
    { module: 'catalog', path: 'catalog/items' },
    { module: 'purchasing', path: 'purchasing/data/items' },
    { module: 'services', path: 'services/data/items' },
  ] as const
).map((a) => {
  @ApiTags('catalog-packages')
  @ApiBearerAuth()
  @RequireModule(a.module)
  @Controller(`${a.path}/:id/packages`)
  class PackagesController {
    constructor(
      @Inject(CatalogPackagingService) private readonly service: CatalogPackagingService,
    ) {}
    @Get()
    @RequirePermissions(`${a.module}.read`)
    list(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: ListQueryDto) {
      return this.service.list(u.tenantId, id, q);
    }
    @Post()
    @RequirePermissions(`${a.module}.read`, `${a.module}.manage`)
    @Audit('catalog-package', AuditAction.CREATE)
    create(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Body() d: CreateCatalogPackageDto,
    ) {
      return this.service.create(u.tenantId, id, d);
    }
    @Patch(':packageId')
    @RequirePermissions(`${a.module}.read`, `${a.module}.manage`)
    @Audit('catalog-package', AuditAction.UPDATE)
    update(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Param('packageId') packageId: string,
      @Body() d: UpdateCatalogPackageDto,
    ) {
      return this.service.update(u.tenantId, id, packageId, d);
    }
  }
  Object.defineProperty(PackagesController, 'name', { value: `CatalogPackages_${a.module}` });
  return PackagesController;
});
@ApiTags('purchasing')
@ApiBearerAuth()
@RequireModule('purchasing')
@Controller('purchasing/orders')
export class PurchasePackageScanController {
  constructor(private readonly service: CatalogPackagingService) {}
  @Post(':id/resolve-package')
  @HttpCode(200)
  @RequirePermissions('purchasing.read')
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ResolvePackageDto) {
    return this.service.resolve(u.tenantId, id, d.code);
  }
}
