import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { BusinessService } from './business.service';
import { ServicesAvailabilityService } from './services-availability.service';
import { ServicesAvailabilityDto } from './services-availability.dto';
import { ServicesTimeService } from './services-time.service';
import { ServicesPartsService } from './services-parts.service';
import { SupplierReceiptsService } from './supplier-receipts.service';
import {
  CatalogStockLinkDto,
  CreateSupplierReceiptDto,
  ConsumeServicePartDto,
  ReturnServicePartDto,
  ServicePartQueryDto,
} from './business.dto';
import {
  BusinessQueryDto,
  CreatePartnerDto,
  UpdatePartnerDto,
  CreateCatalogItemDto,
  UpdateCatalogItemDto,
  CreateProjectDto,
  UpdateProjectDto,
  ProjectTransitionDto,
  CreateJobDto,
  UpdateJobDto,
  JobTransitionDto,
  CreateSupplierOrderDto,
  UpdateSupplierOrderDto,
  SupplierOrderTransitionDto,
  ServiceTimeQueryDto,
  CreateServiceTimeDto,
  UpdateServiceTimeDto,
  VoidServiceTimeDto,
  ReviewServiceTimeDto,
} from './business.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
@RequireModule(MODULE_KEYS.CATALOG)
export class CatalogController {
  constructor(
    private readonly business: BusinessService,
    private readonly parts: ServicesPartsService,
  ) {}
  @Get('items/:id/stock-link')
  @RequirePermissions(PERMISSIONS.CATALOG.READ, PERMISSIONS.WMS.READ)
  stockLink(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.parts.link(u.tenantId, id);
  }
  @Patch('items/:id/stock-link')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE, PERMISSIONS.WMS.READ)
  @Audit('catalog-stock-link', AuditAction.UPDATE)
  setStockLink(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: CatalogStockLinkDto,
  ) {
    return this.parts.setLink(u.tenantId, id, dto);
  }
  @Get('partners')
  @RequirePermissions(PERMISSIONS.CATALOG.READ)
  partners(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.partners(u.tenantId, q);
  }
  @Post('partners')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE)
  @Audit('business-partner', AuditAction.CREATE)
  createPartner(@CurrentUser() u: AuthUser, @Body() dto: CreatePartnerDto) {
    return this.business.createPartner(u.tenantId, dto);
  }
  @Patch('partners/:id')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE)
  @Audit('business-partner', AuditAction.UPDATE)
  updatePartner(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.business.updatePartner(u.tenantId, id, dto);
  }
  @Get('items')
  @RequirePermissions(PERMISSIONS.CATALOG.READ)
  items(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.items(u.tenantId, q);
  }
  @Post('items')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE)
  @Audit('catalog-item', AuditAction.CREATE)
  createItem(@CurrentUser() u: AuthUser, @Body() dto: CreateCatalogItemDto) {
    return this.business.createItem(u.tenantId, dto);
  }
  @Patch('items/:id')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE)
  @Audit('catalog-item', AuditAction.UPDATE)
  updateItem(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.business.updateItem(u.tenantId, id, dto);
  }
}

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
@RequireModule(MODULE_KEYS.SERVICES)
export class ServicesController {
  constructor(
    private readonly business: BusinessService,
    private readonly availability: ServicesAvailabilityService,
    private readonly time: ServicesTimeService,
    private readonly parts: ServicesPartsService,
  ) {}
  @Post('availability/check')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.HR.AVAILABILITY_READ)
  checkAvailability(@CurrentUser() u: AuthUser, @Body() dto: ServicesAvailabilityDto) {
    return this.availability.check(u, dto);
  }
  @Get('references/parts')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.WMS.READ)
  partProducts(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.parts.products(u.tenantId, q);
  }
  @Get('references/part-bins')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.WMS.READ)
  partBins(@CurrentUser() u: AuthUser, @Query() q: ServicePartQueryDto) {
    return this.parts.bins(u.tenantId, q);
  }
  @Get('jobs/:id/parts')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  jobParts(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: BusinessQueryDto) {
    return this.parts.list(u.tenantId, id, q);
  }
  @Post('jobs/:id/parts')
  @RequirePermissions(
    PERMISSIONS.SERVICES.READ,
    PERMISSIONS.SERVICES.MANAGE,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.WMS.MANAGE,
  )
  consumePart(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConsumeServicePartDto,
  ) {
    return this.parts.consume(u, id, dto);
  }
  @Post('jobs/:id/parts/:partId/return')
  @RequirePermissions(
    PERMISSIONS.SERVICES.READ,
    PERMISSIONS.SERVICES.MANAGE,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.WMS.MANAGE,
  )
  returnPart(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('partId') partId: string,
    @Body() dto: ReturnServicePartDto,
  ) {
    return this.parts.returnPart(u, id, partId, dto);
  }
  @Get('references/people')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  people(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.people(u.tenantId, q);
  }
  @Get('time-entries')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  timeEntries(@CurrentUser() u: AuthUser, @Query() q: ServiceTimeQueryDto) {
    return this.time.list(u.tenantId, q);
  }
  @Post('time-entries')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  createTime(@CurrentUser() u: AuthUser, @Body() dto: CreateServiceTimeDto) {
    // Service additionally enforces manager OR time.write + ownership (ALL decorator cannot express OR).
    return this.time.create(u, dto);
  }
  @Patch('time-entries/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  updateTime(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceTimeDto,
  ) {
    return this.time.update(u, id, dto);
  }
  @Post('time-entries/:id/void')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  voidTime(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: VoidServiceTimeDto) {
    return this.time.void(u, id, dto);
  }
  @Get('time-entries/:id/reviews')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  timeReviews(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: BusinessQueryDto) {
    return this.time.reviews(u.tenantId, id, q);
  }
  @Post('time-entries/:id/review')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  reviewTime(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewServiceTimeDto,
  ) {
    // Action-specific approver/owner permissions are rechecked by the service.
    return this.time.review(u, id, dto);
  }
  @Get('references/customers')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  customers(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.partners(u.tenantId, q, 'isCustomer');
  }
  @Get('references/items')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  items(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.items(u.tenantId, q, 'services');
  }
  @Get('projects')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  projects(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.projects(u.tenantId, q);
  }
  @Get('projects/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  project(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.business.project(u.tenantId, id);
  }
  @Post('projects')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  @Audit('service-project', AuditAction.CREATE)
  createProject(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) {
    return this.business.createProject(u.tenantId, dto);
  }
  @Patch('projects/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  @Audit('service-project', AuditAction.UPDATE)
  updateProject(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.business.updateProject(u.tenantId, id, dto);
  }
  @Post('projects/:id/transition')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  transitionProject(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ProjectTransitionDto,
  ) {
    return this.business.transitionProject(u.tenantId, u.id, id, dto);
  }
  @Get('jobs')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  jobs(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.jobs(u.tenantId, q, u.id);
  }
  @Get('jobs/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  job(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.business.job(u.tenantId, id);
  }
  @Post('jobs')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  @Audit('service-job', AuditAction.CREATE)
  createJob(@CurrentUser() u: AuthUser, @Body() dto: CreateJobDto) {
    return this.business.createJob(u.tenantId, dto);
  }
  @Patch('jobs/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  @Audit('service-job', AuditAction.UPDATE)
  updateJob(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.business.updateJob(u.tenantId, id, dto);
  }
  @Post('jobs/:id/transition')
  @RequirePermissions(PERMISSIONS.SERVICES.MANAGE)
  transitionJob(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: JobTransitionDto,
  ) {
    return this.business.transitionJob(u.tenantId, u.id, id, dto);
  }
}

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing')
@RequireModule(MODULE_KEYS.PURCHASING)
export class PurchasingController {
  constructor(
    private readonly business: BusinessService,
    private readonly receiving: SupplierReceiptsService,
  ) {}
  @Get('orders/:id/receipts')
  @RequirePermissions(PERMISSIONS.PURCHASING.READ)
  receipts(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: BusinessQueryDto) {
    return this.receiving.list(u.tenantId, id, q);
  }
  @Post('orders/:id/receipts')
  @RequirePermissions(
    PERMISSIONS.PURCHASING.READ,
    PERMISSIONS.PURCHASING.MANAGE,
    PERMISSIONS.WMS.READ,
    PERMISSIONS.WMS.MANAGE,
  )
  receive(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSupplierReceiptDto,
  ) {
    return this.receiving.create(u.tenantId, u.id, id, dto);
  }
  @Get('references/suppliers')
  @RequirePermissions(PERMISSIONS.PURCHASING.READ)
  suppliers(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.partners(u.tenantId, q, 'isSupplier');
  }
  @Get('references/items')
  @RequirePermissions(PERMISSIONS.PURCHASING.READ)
  items(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.items(u.tenantId, q, 'purchasing');
  }
  @Get('orders')
  @RequirePermissions(PERMISSIONS.PURCHASING.READ)
  orders(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.orders(u.tenantId, q);
  }
  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.PURCHASING.READ)
  order(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.business.order(u.tenantId, id);
  }
  @Post('orders')
  @RequirePermissions(PERMISSIONS.PURCHASING.MANAGE)
  @Audit('supplier-order', AuditAction.CREATE)
  createOrder(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierOrderDto) {
    return this.business.createOrder(u.tenantId, dto);
  }
  @Patch('orders/:id')
  @RequirePermissions(PERMISSIONS.PURCHASING.MANAGE)
  @Audit('supplier-order', AuditAction.UPDATE)
  updateOrder(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierOrderDto,
  ) {
    return this.business.updateOrder(u.tenantId, id, dto);
  }
  @Post('orders/:id/transition')
  @RequirePermissions(PERMISSIONS.PURCHASING.MANAGE)
  transitionOrder(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: SupplierOrderTransitionDto,
  ) {
    return this.business.transitionOrder(u.tenantId, u.id, id, dto);
  }
}
