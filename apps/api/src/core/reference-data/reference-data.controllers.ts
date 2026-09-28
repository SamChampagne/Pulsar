import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags, OmitType } from '@nestjs/swagger';
import { AuditAction, AuthUser, REFERENCE_ACCESS, type ReferenceAccess } from '@pulsar/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  BusinessQueryDto,
  CreatePartnerDto,
  UpdatePartnerDto,
  CreateCatalogItemDto,
  UpdateCatalogItemDto,
} from '../../modules/business/business.dto';
import { BusinessService } from '../../modules/business/business.service';
import { CustomersService } from '../../modules/transportation/customers/customers.service';
import { CarriersService } from '../../modules/transportation/carriers/carriers.service';
import { DriversService } from '../../modules/transportation/drivers/drivers.service';
import { VehiclesService } from '../../modules/transportation/vehicles/vehicles.service';
import { TrailersService } from '../../modules/transportation/trailers/trailers.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from '../../modules/transportation/customers/dto/customer.dto';
import {
  CreateCarrierDto,
  UpdateCarrierDto,
} from '../../modules/transportation/carriers/dto/carrier.dto';
import {
  CreateDriverDto,
  UpdateDriverDto,
} from '../../modules/transportation/drivers/dto/driver.dto';
import {
  CreateVehicleDto,
  UpdateVehicleDto,
} from '../../modules/transportation/vehicles/dto/vehicle.dto';
import {
  CreateTrailerDto,
  UpdateTrailerDto,
} from '../../modules/transportation/trailers/dto/trailer.dto';

class CreateContactDto extends OmitType(CreatePartnerDto, ['isCustomer', 'isSupplier'] as const) {}
class UpdateContactDto extends OmitType(UpdatePartnerDto, ['isCustomer', 'isSupplier'] as const) {}
// An identity editor cannot change operational availability; maintenance owns this workflow.
class EditVehicleDto extends OmitType(UpdateVehicleDto, ['status', 'unitNumber'] as const) {}
class EditTrailerDto extends OmitType(UpdateTrailerDto, ['status', 'unitNumber'] as const) {}

// This factory generates *static*, individually guarded routes from a closed server catalogue.
// expectedType is essential: erased factory generics must never bypass DTO validation.
function referenceController<Create extends object, Update extends object>(
  access: ReferenceAccess,
  serviceType: Type,
  createType: Type<Create>,
  updateType: Type<Update>,
  adapter: {
    list(service: any, tenant: string, q: BusinessQueryDto): Promise<any>;
    get(service: any, tenant: string, id: string): Promise<any>;
    create(service: any, tenant: string, dto: Create): Promise<any>;
    update(service: any, tenant: string, id: string, dto: Update): Promise<any>;
  },
) {
  const pipe = (expectedType: Type) =>
    new ValidationPipe({
      expectedType,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  @ApiTags('reference-data')
  @ApiBearerAuth()
  @Controller(access.path)
  @RequireModule(access.module)
  class ReferenceController {
    constructor(@Inject(serviceType) private readonly service: unknown) {}
    @Get()
    @RequirePermissions(access.read)
    list(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
      return adapter.list(this.service, u.tenantId, q);
    }
    @Get(':id')
    @RequirePermissions(access.read)
    get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      return adapter.get(this.service, u.tenantId, id);
    }
    @Post()
    @ApiBody({ type: createType })
    @RequirePermissions(access.read, access.manage)
    @Audit(
      access.kind === 'client' || access.kind === 'supplier'
        ? 'business-partner'
        : access.kind === 'item'
          ? 'catalog-item'
          : access.kind,
      AuditAction.CREATE,
    )
    create(@CurrentUser() u: AuthUser, @Body(pipe(createType)) dto: Create) {
      return adapter.create(this.service, u.tenantId, dto);
    }
    @Patch(':id')
    @ApiBody({ type: updateType })
    @RequirePermissions(access.read, access.manage)
    @Audit(
      access.kind === 'client' || access.kind === 'supplier'
        ? 'business-partner'
        : access.kind === 'item'
          ? 'catalog-item'
          : access.kind,
      AuditAction.UPDATE,
    )
    update(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Body(pipe(updateType)) dto: Update,
    ) {
      return adapter.update(this.service, u.tenantId, id, dto);
    }
  }
  Object.defineProperty(ReferenceController, 'name', {
    value: `Reference_${access.path.replace(/\W/g, '_')}`,
  });
  return ReferenceController;
}

const metadata = {
  customer: [CustomersService, CreateCustomerDto, UpdateCustomerDto],
  carrier: [CarriersService, CreateCarrierDto, UpdateCarrierDto],
  driver: [DriversService, CreateDriverDto, UpdateDriverDto],
  vehicle: [VehiclesService, CreateVehicleDto, EditVehicleDto],
  trailer: [TrailersService, CreateTrailerDto, EditTrailerDto],
} as const;

/** Explicit projections: no related dossier, portal configuration, notes or nested contact leaks. */
const fields = {
  customer: [
    'billingAddress',
    'shippingAddress',
    'id',
    'code',
    'name',
    'contactName',
    'email',
    'phone',
    'isActive',
    'createdAt',
    'updatedAt',
  ],
  carrier: [
    'id',
    'code',
    'name',
    'scacCode',
    'mcNumber',
    'dotNumber',
    'contactName',
    'email',
    'phone',
    'status',
    'createdAt',
    'updatedAt',
  ],
  driver: [
    'id',
    'firstName',
    'lastName',
    'carrierId',
    'licenseNumber',
    'phone',
    'email',
    'status',
    'createdAt',
    'updatedAt',
  ],
  vehicle: [
    'id',
    'unitNumber',
    'type',
    'carrierId',
    'make',
    'model',
    'year',
    'vin',
    'plate',
    'status',
    'customData',
    'createdAt',
    'updatedAt',
  ],
  trailer: [
    'id',
    'unitNumber',
    'type',
    'carrierId',
    'capacityWeightKg',
    'capacityVolumeM3',
    'capacityPallets',
    'plate',
    'status',
    'customData',
    'createdAt',
    'updatedAt',
  ],
};
export const ReferenceDataControllers = REFERENCE_ACCESS.map((access) => {
  if (access.kind === 'client' || access.kind === 'supplier') {
    const role = access.kind === 'client' ? 'isCustomer' : 'isSupplier';
    return referenceController(access, BusinessService, CreateContactDto, UpdateContactDto, {
      list: (s: BusinessService, t, q) => s.partners(t, q, role, true),
      get: (s: BusinessService, t, id) => s.referencePartner(t, id, role),
      create: (s: BusinessService, t, dto) =>
        s.createPartner(t, {
          ...dto,
          isCustomer: role === 'isCustomer',
          isSupplier: role === 'isSupplier',
        }),
      update: (s: BusinessService, t, id, dto) => s.updatePartner(t, id, dto, role),
    });
  }
  const itemProjection = (row: Record<string, unknown>) =>
    Object.fromEntries(
      ['id', 'code', 'name', 'kind', 'unit', 'description', 'active', 'createdAt', 'updatedAt']
        .filter((k) => k in row)
        .map((k) => [k, row[k]]),
    );
  if (access.kind === 'item')
    return referenceController(
      access,
      BusinessService,
      CreateCatalogItemDto,
      UpdateCatalogItemDto,
      {
        list: async (s: BusinessService, t, q) => {
          const page = await s.items(t, q);
          return { ...page, items: page.items.map(itemProjection) };
        },
        get: async (s: BusinessService, t, id) => itemProjection(await s.referenceItem(t, id)),
        create: async (s: BusinessService, t, dto) => itemProjection(await s.createItem(t, dto)),
        update: async (s: BusinessService, t, id, dto) =>
          itemProjection(await s.updateItem(t, id, dto)),
      },
    );
  const [service, create, update] = metadata[access.kind];
  const allowed = fields[access.kind];
  const project = (row: Record<string, unknown>) =>
    Object.fromEntries(allowed.filter((k) => k in row).map((k) => [k, row[k]]));
  return referenceController(access, service as Type, create as Type, update as Type, {
    list: async (s, t, q) => {
      const page = await s.list(t, q);
      return { ...page, items: page.items.map(project) };
    },
    get: async (s, t, id) => project(await s.get(t, id)),
    create: async (s, t, dto) => project(await s.create(t, dto)),
    update: async (s, t, id, dto) => project(await s.update(t, id, dto)),
  });
});
