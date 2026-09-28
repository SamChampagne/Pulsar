import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, MODULE_KEYS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SupplierDossiersService } from './supplier-dossiers.service';
import { SupplierDossierDirectoryDto, SupplierDossierQueryDto } from './supplier-dossiers.dto';
@ApiTags('billing/supplier-dossiers')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/supplier-dossiers')
export class SupplierDossiersController {
  constructor(private readonly service: SupplierDossiersService) {}
  @Get() @RequirePermissions('billing.supplier-invoices.read') directory(
    @CurrentUser() u: AuthUser,
    @Query() q: SupplierDossierDirectoryDto,
  ) {
    return this.service.directory(u, q);
  }
  @Get(':id') @RequirePermissions('billing.supplier-invoices.read') overview(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.overview(u, id);
  }
  @Get(':id/documents') @RequirePermissions('billing.supplier-invoices.read') documents(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: SupplierDossierQueryDto,
  ) {
    return this.service.list(u, id, q);
  }
  @Get(':id/evidence') @RequirePermissions('billing.supplier-invoices.read') evidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: SupplierDossierQueryDto,
  ) {
    return this.service.evidence(u, id, q);
  }
}
