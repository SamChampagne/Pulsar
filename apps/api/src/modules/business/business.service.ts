import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { captureSupplierTerms } from './catalog-details.service';
import { capturePackage } from './catalog-packaging.service';
import type { CatalogPackageSnapshot } from '@pulsar/shared';
import type { SupplierTermsSnapshot } from '@pulsar/shared';
import {
  AuditAction,
  canTransitionServiceProject,
  canTransitionServiceJob,
  canTransitionSupplierOrder,
  ServiceProjectStatus,
  ServiceJobStatus,
  SupplierOrderStatus,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentCoordinatesService } from '../../core/reference-data/document-coordinates.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { receiptProgress, supplierReceiptLines } from './supplier-receipts.service';
import { assertServiceSlot } from './service-scheduling';
import {
  lockBusinessTenant,
  nextBusinessVersion,
  assertServicePerson,
  servicePersonSelect,
} from './business-lock';
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
  SupplierLineDto,
} from './business.dto';

type Tx = Prisma.TransactionClient;
import { addressData } from '../../common/dto/postal-address.dto';
const partnerSummary = { id: true, code: true, name: true } as const;
const partnerPublic = {
  billingAddress: true,
  shippingAddress: true,
  ...partnerSummary,
  active: true,
  email: true,
  phone: true,
  isCustomer: true,
  isSupplier: true,
  updatedAt: true,
  createdAt: true,
} as const;
const itemSummary = { id: true, code: true, name: true, kind: true, unit: true } as const;
const projectInclude = {
  partner: { select: partnerSummary },
  _count: { select: { jobs: true } },
} as const;
const jobInclude = {
  project: {
    select: { id: true, number: true, title: true, status: true, acceptanceRequired: true },
  },
  assignee: { select: servicePersonSelect },
  catalogItem: { select: itemSummary },
} as const;
const orderInclude = {
  supplier: { select: partnerSummary },
  lines: { orderBy: { position: 'asc' as const }, include: supplierReceiptLines },
};
const date = (value: string | null | undefined) =>
  value === undefined ? undefined : value ? new Date(value) : null;
const search = (value: string | undefined, fields: string[]) =>
  value
    ? { OR: fields.map((field) => ({ [field]: { contains: value, mode: 'insensitive' } })) }
    : {};

@Injectable()
export class BusinessService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly coordinates: DocumentCoordinatesService,
  ) {}
  private async locked<T>(tenantId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        return work(tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Ce code existe déjà dans votre entreprise.');
      throw e;
    }
  }
  private version(row: { updatedAt: Date }, expected: string) {
    return nextBusinessVersion(row, expected);
  }
  private found<T>(row: T | null): T {
    if (!row) throw new NotFoundException('Dossier introuvable.');
    return row;
  }
  private async partner(tx: Tx, tenantId: string, id: string, role: 'isCustomer' | 'isSupplier') {
    await this.ownership.assertOwned('businessPartner', id, tenantId);
    const row = await tx.businessPartner.findFirst({
      where: { tenantId, id, active: true, [role]: true },
    });
    if (!row) throw new BadRequestException('Choisissez un partenaire actif avec le bon rôle.');
    return row;
  }
  private async item(tx: Tx, tenantId: string, id: string, serviceOnly = false) {
    await this.ownership.assertOwned('catalogItem', id, tenantId);
    const row = await tx.catalogItem.findFirst({
      where: { tenantId, id, active: true, ...(serviceOnly ? { kind: 'SERVICE' } : {}) },
    });
    if (!row)
      throw new BadRequestException(
        serviceOnly ? 'Choisissez une prestation active.' : 'Choisissez un article actif.',
      );
    return row;
  }
  async partners(
    tenantId: string,
    q: BusinessQueryDto,
    role?: 'isCustomer' | 'isSupplier',
    workspace = false,
  ) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.BusinessPartnerWhereInput = {
      tenantId,
      ...search(q.search, ['code', 'name']),
      ...(role
        ? {
            [role]: true,
            ...(!workspace ? { active: true } : q.active ? { active: q.active === 'true' } : {}),
          }
        : q.active
          ? { active: q.active === 'true' }
          : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.businessPartner.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: role && !workspace ? partnerSummary : partnerPublic,
      }),
      this.db.businessPartner.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async items(tenantId: string, q: BusinessQueryDto, consumer?: 'services' | 'purchasing') {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.CatalogItemWhereInput = {
      tenantId,
      ...search(q.search, ['code', 'name']),
      ...(consumer
        ? { active: true, ...(consumer === 'services' ? { kind: 'SERVICE' } : {}) }
        : q.active
          ? { active: q.active === 'true' }
          : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.catalogItem.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        ...(consumer ? { select: itemSummary } : {}),
      }),
      this.db.catalogItem.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async createPartner(tenantId: string, dto: CreatePartnerDto) {
    if (!dto.isCustomer && !dto.isSupplier)
      throw new BadRequestException('Choisissez au moins un rôle.');
    return this.locked(tenantId, (tx) =>
      tx.businessPartner.create({
        data: { ...dto, ...addressData(dto), tenantId },
        select: partnerPublic,
      }),
    );
  }
  async referencePartner(tenantId: string, id: string, role: 'isCustomer' | 'isSupplier') {
    return this.found(
      await this.db.businessPartner.findFirst({
        where: { tenantId, id, [role]: true },
        select: partnerPublic,
      }),
    );
  }
  async referenceItem(tenantId: string, id: string) {
    return this.found(await this.db.catalogItem.findFirst({ where: { tenantId, id } }));
  }
  async updatePartner(
    tenantId: string,
    id: string,
    dto: UpdatePartnerDto,
    role?: 'isCustomer' | 'isSupplier',
  ) {
    return this.locked(tenantId, async (tx) => {
      const old = this.found(
        await tx.businessPartner.findFirst({
          where: { tenantId, id, ...(role ? { [role]: true } : {}) },
        }),
      );
      const { expectedUpdatedAt, ...data } = dto;
      const updatedAt = this.version(old, expectedUpdatedAt);
      if (!(data.isCustomer ?? old.isCustomer) && !(data.isSupplier ?? old.isSupplier))
        throw new BadRequestException('Choisissez au moins un rôle.');
      await tx.businessPartner.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, ...addressData(dto), updatedAt },
      });
      return tx.businessPartner.findFirstOrThrow({
        where: { tenantId, id },
        select: partnerPublic,
      });
    });
  }
  createItem(tenantId: string, dto: CreateCatalogItemDto) {
    return this.locked(tenantId, (tx) => tx.catalogItem.create({ data: { ...dto, tenantId } }));
  }
  updateItem(tenantId: string, id: string, dto: UpdateCatalogItemDto) {
    return this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.catalogItem.findFirst({ where: { tenantId, id } }));
      const { expectedUpdatedAt, ...data } = dto;
      const updatedAt = this.version(old, expectedUpdatedAt);
      await tx.catalogItem.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, updatedAt },
      });
      return tx.catalogItem.findFirstOrThrow({ where: { tenantId, id } });
    });
  }
  async projects(tenantId: string, q: BusinessQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.ServiceProjectWhereInput = {
      tenantId,
      ...search(q.search, ['number', 'title']),
      ...(q.active === 'true' ? { status: 'ACTIVE' } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.serviceProject.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: projectInclude,
      }),
      this.db.serviceProject.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async project(tenantId: string, id: string) {
    return this.found(
      await this.db.serviceProject.findFirst({ where: { tenantId, id }, include: projectInclude }),
    );
  }
  async createProject(tenantId: string, dto: CreateProjectDto) {
    const number = await this.sequences.nextNumber(tenantId, 'service-project');
    return this.locked(tenantId, async (tx) => {
      await this.partner(tx, tenantId, dto.partnerId, 'isCustomer');
      return tx.serviceProject.create({
        data: { ...dto, tenantId, number, dueDate: date(dto.dueDate) },
        include: projectInclude,
      });
    });
  }
  updateProject(tenantId: string, id: string, dto: UpdateProjectDto) {
    return this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.serviceProject.findFirst({ where: { tenantId, id } }));
      if (!['DRAFT', 'ACTIVE'].includes(old.status))
        throw new ConflictException('Un projet fermé est en lecture seule.');
      const { expectedUpdatedAt, ...data } = dto;
      const updatedAt = this.version(old, expectedUpdatedAt);
      if (data.partnerId) await this.partner(tx, tenantId, data.partnerId, 'isCustomer');
      if (
        data.acceptanceRequired !== undefined &&
        data.acceptanceRequired !== old.acceptanceRequired &&
        old.status !== 'DRAFT'
      )
        throw new ConflictException(
          'L’exigence d’acceptation se choisit avant l’activation du projet.',
        );
      if (
        data.partnerId &&
        data.partnerId !== old.partnerId &&
        (await tx.serviceAcceptanceRecord.count({
          where: { tenantId, job: { tenantId, projectId: id } },
        }))
      )
        throw new ConflictException(
          'Le client est figé par l’historique d’acceptation des travaux.',
        );
      if (
        data.partnerId &&
        data.partnerId !== old.partnerId &&
        ((await tx.serviceQuote.count({ where: { tenantId, projectId: id } })) ||
          (await tx.serviceInvoiceBatch.count({ where: { tenantId, projectId: id } })))
      )
        throw new ConflictException(
          'Le client est figé par le devis accepté ou l’historique de facturation.',
        );
      if (
        data.partnerId &&
        data.partnerId !== old.partnerId &&
        (await tx.supportCase.count({
          where: {
            tenantId,
            partnerId: { not: data.partnerId },
            job: { tenantId, projectId: id },
          },
        }))
      )
        throw new ConflictException(
          'Le client du projet est lié à un dossier SAV. Retirez le lien SAV avant de changer de client.',
        );
      await tx.serviceProject.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, dueDate: date(data.dueDate), updatedAt },
      });
      return tx.serviceProject.findFirstOrThrow({
        where: { tenantId, id },
        include: projectInclude,
      });
    });
  }
  async transitionProject(tenantId: string, userId: string, id: string, dto: ProjectTransitionDto) {
    const result = await this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.serviceProject.findFirst({ where: { tenantId, id } }));
      const updatedAt = this.version(old, dto.expectedUpdatedAt);
      if (!canTransitionServiceProject(old.status as ServiceProjectStatus, dto.status))
        throw new ConflictException('Transition de projet interdite.');
      if (
        ['COMPLETED', 'CANCELLED'].includes(dto.status) &&
        (await tx.serviceJob.count({
          where: { tenantId, projectId: id, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
        }))
      )
        throw new ConflictException(
          'Terminez ou annulez les interventions ouvertes avant de fermer le projet.',
        );
      if (dto.status === 'ACTIVE') await this.partner(tx, tenantId, old.partnerId, 'isCustomer');
      if (
        dto.status === 'COMPLETED' &&
        old.acceptanceRequired &&
        (await tx.serviceJob.count({
          where: {
            tenantId,
            projectId: id,
            status: 'COMPLETED',
            acceptanceStatus: { not: 'ACCEPTED' },
          },
        }))
      )
        throw new ConflictException(
          'Recueillez l’acceptation des interventions terminées avant de clôturer ce projet.',
        );
      if (
        ['COMPLETED', 'CANCELLED'].includes(dto.status) &&
        (await tx.serviceTimeEntry.count({
          where: {
            tenantId,
            job: { tenantId, projectId: id },
            status: { in: ['RECORDED', 'SUBMITTED', 'REJECTED'] },
          },
        }))
      )
        throw new ConflictException(
          'Traitez les temps du projet avant clôture : ils doivent être approuvés ou annulés.',
        );
      await tx.serviceProject.updateMany({
        where: { tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: { status: dto.status, updatedAt },
      });
      return {
        before: old,
        after: await tx.serviceProject.findFirstOrThrow({
          where: { tenantId, id },
          include: projectInclude,
        }),
      };
    });
    await this.audit.log({
      tenantId,
      userId,
      entityType: 'service-project',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      ...result,
    });
    return result.after;
  }
  async people(tenantId: string, q: BusinessQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.UserWhereInput = {
      tenantId,
      status: 'ACTIVE',
      agentServiceFor: { none: {} },
      NOT: { email: 'service-account@pulsar.local' },
      ...(q.search?.trim()
        ? {
            AND: q.search
              .trim()
              .split(/\s+/)
              .map((term) => search(term, ['firstName', 'lastName'])),
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: servicePersonSelect,
        skip,
        take,
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
      }),
      this.db.user.count({ where }),
    ]);
    return paginated(
      rows.map((p) => ({ ...p, name: `${p.firstName} ${p.lastName}`.trim() })),
      total,
      page,
      pageSize,
    );
  }
  async jobs(tenantId: string, q: BusinessQueryDto, userId?: string) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.ServiceJobWhereInput = {
      tenantId,
      ...search(q.search, ['number', 'title', 'assigneeLabel']),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.assignment === 'mine'
        ? { assigneeUserId: userId ?? '__none__' }
        : q.assignment === 'unassigned'
          ? { assigneeUserId: null }
          : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.serviceJob.findMany({
        where,
        skip,
        take,
        orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: jobInclude,
      }),
      this.db.serviceJob.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async job(tenantId: string, id: string) {
    return this.found(
      await this.db.serviceJob.findFirst({ where: { tenantId, id }, include: jobInclude }),
    );
  }
  private async openProject(tx: Tx, tenantId: string, id: string) {
    await this.ownership.assertOwned('serviceProject', id, tenantId);
    const project = this.found(await tx.serviceProject.findFirst({ where: { tenantId, id } }));
    if (project.status !== 'ACTIVE')
      throw new ConflictException(
        'Activez le projet avant de planifier ou démarrer une intervention.',
      );
  }
  async createJob(tenantId: string, dto: CreateJobDto) {
    const number = await this.sequences.nextNumber(tenantId, 'service-job');
    return this.locked(tenantId, async (tx) => {
      await this.openProject(tx, tenantId, dto.projectId);
      if (dto.catalogItemId) await this.item(tx, tenantId, dto.catalogItemId, true);
      if (dto.assigneeUserId)
        await assertServicePerson(tx, this.ownership, tenantId, dto.assigneeUserId);
      await assertServiceSlot(tx, tenantId, {
        assigneeUserId: dto.assigneeUserId ?? null,
        scheduledAt: date(dto.scheduledAt) ?? null,
        plannedMinutes: dto.plannedMinutes ?? null,
      });
      return tx.serviceJob.create({
        data: { ...dto, tenantId, number, scheduledAt: date(dto.scheduledAt) },
        include: jobInclude,
      });
    });
  }
  updateJob(tenantId: string, id: string, dto: UpdateJobDto) {
    return this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.serviceJob.findFirst({ where: { tenantId, id } }));
      if (!['PLANNED', 'IN_PROGRESS'].includes(old.status))
        throw new ConflictException('Une intervention fermée est en lecture seule.');
      await this.openProject(tx, tenantId, old.projectId);
      const { expectedUpdatedAt, ...data } = dto;
      const updatedAt = this.version(old, expectedUpdatedAt);
      if (dto.catalogItemId) await this.item(tx, tenantId, dto.catalogItemId, true);
      if (dto.assigneeUserId)
        await assertServicePerson(tx, this.ownership, tenantId, dto.assigneeUserId);
      await assertServiceSlot(
        tx,
        tenantId,
        {
          assigneeUserId:
            dto.assigneeUserId === undefined ? old.assigneeUserId : dto.assigneeUserId,
          scheduledAt:
            dto.scheduledAt === undefined ? old.scheduledAt : (date(dto.scheduledAt) ?? null),
          plannedMinutes:
            dto.plannedMinutes === undefined ? old.plannedMinutes : dto.plannedMinutes,
        },
        id,
      );
      await tx.serviceJob.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, scheduledAt: date(data.scheduledAt), updatedAt },
      });
      return tx.serviceJob.findFirstOrThrow({ where: { tenantId, id }, include: jobInclude });
    });
  }
  async transitionJob(tenantId: string, userId: string, id: string, dto: JobTransitionDto) {
    const result = await this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.serviceJob.findFirst({ where: { tenantId, id } }));
      const updatedAt = this.version(old, dto.expectedUpdatedAt);
      if (!canTransitionServiceJob(old.status as ServiceJobStatus, dto.status))
        throw new ConflictException('Transition d’intervention interdite.');
      await this.openProject(tx, tenantId, old.projectId);
      if (dto.status === 'COMPLETED' && !dto.report?.trim())
        throw new BadRequestException('Le compte rendu est obligatoire pour terminer.');
      if (
        dto.status === 'CANCELLED' &&
        (await tx.servicePartUsage.count({
          where: {
            tenantId,
            jobId: id,
            returnedQuantity: { lt: tx.servicePartUsage.fields.quantity },
          },
        }))
      )
        throw new ConflictException(
          'Retournez les pièces avant d’annuler, ou terminez avec un rapport si elles ont réellement été consommées.',
        );
      await tx.serviceJob.updateMany({
        where: { tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: {
          status: dto.status,
          updatedAt,
          ...(dto.status === 'COMPLETED' ? { report: dto.report, completedAt: new Date() } : {}),
        },
      });
      return {
        before: old,
        after: await tx.serviceJob.findFirstOrThrow({
          where: { tenantId, id },
          include: jobInclude,
        }),
      };
    });
    await this.audit.log({
      tenantId,
      userId,
      entityType: 'service-job',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      ...result,
    });
    return result.after;
  }
  private total<
    T extends {
      lines: Prisma.SupplierOrderLineGetPayload<{ include: typeof supplierReceiptLines }>[];
    },
  >(order: T) {
    return {
      ...order,
      lines: order.lines.map(({ receipts, catalogItem, ...line }) => ({
        ...line,
        ...receiptProgress({ ...line, receipts, catalogItem }),
      })),
      total: order.lines
        .reduce((s, l) => s.plus(l.quantity.mul(l.unitPrice)), new Prisma.Decimal(0))
        .toFixed(2),
    };
  }
  async orders(tenantId: string, q: BusinessQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.SupplierOrderWhereInput = {
      tenantId,
      ...(q.orderStatus ? { status: q.orderStatus } : {}),
      ...(q.orderFollowup === 'late'
        ? {
            AND: [
              { status: 'CONFIRMED' },
              { expectedDate: { lt: new Date(new Date().toISOString().slice(0, 10)) } },
            ],
          }
        : {}),
      ...search(q.search, ['number', 'notes']),
    };
    const [items, total] = await this.db.$transaction([
      this.db.supplierOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: orderInclude,
      }),
      this.db.supplierOrder.count({ where }),
    ]);
    return paginated(
      items.map((x) => this.total(x)),
      total,
      page,
      pageSize,
    );
  }
  async order(tenantId: string, id: string) {
    return this.total(
      this.found(
        await this.db.supplierOrder.findFirst({ where: { tenantId, id }, include: orderInclude }),
      ),
    );
  }
  private async lines(
    tx: Tx,
    tenantId: string,
    lines: SupplierLineDto[],
    supplierId: string,
    currency: string,
  ) {
    return Promise.all(
      lines.map(async (line, position) => {
        const item = await this.item(tx, tenantId, line.catalogItemId);
        const packageFields = [line.packageId, line.packageVersion, line.packageCount].filter(
          (v) => v !== undefined,
        ).length;
        if (packageFields !== 0 && packageFields !== 3)
          throw new BadRequestException(
            'Choisissez ensemble le conditionnement, sa version et son nombre.',
          );
        if (line.packageId)
          await this.ownership.assertOwned('catalogPackage', line.packageId, tenantId, tx);
        const packageSnapshot = line.packageId
          ? await capturePackage(
              tx,
              tenantId,
              item.id,
              line.packageId,
              line.packageVersion!,
              line.packageCount!,
              new Prisma.Decimal(line.quantity),
            )
          : undefined;
        if (!!line.supplierOfferId !== !!line.supplierOfferVersion)
          throw new BadRequestException(
            'Référence fournisseur et version doivent être choisies ensemble.',
          );
        if (line.supplierOfferId)
          await this.ownership.assertOwned(
            'catalogSupplierOffer',
            line.supplierOfferId,
            tenantId,
            tx,
          );
        const supplierTermsSnapshot = line.supplierOfferId
          ? await captureSupplierTerms(tx, tenantId, {
              offerId: line.supplierOfferId,
              version: line.supplierOfferVersion!,
              supplierId,
              currency,
              catalogItemId: item.id,
              quantity: new Prisma.Decimal(line.quantity),
              unitPrice: new Prisma.Decimal(line.unitPrice),
            })
          : undefined;
        return {
          ...(packageSnapshot
            ? { packageSnapshot: packageSnapshot as unknown as Prisma.InputJsonObject }
            : {}),
          ...(supplierTermsSnapshot
            ? { supplierTermsSnapshot: supplierTermsSnapshot as unknown as Prisma.InputJsonObject }
            : {}),
          tenantId,
          position,
          catalogItemId: item.id,
          nameSnapshot: item.name,
          unitSnapshot: item.unit,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
        };
      }),
    );
  }
  async createOrder(tenantId: string, dto: CreateSupplierOrderDto) {
    const number = await this.sequences.nextNumber(tenantId, 'supplier-order');
    return this.locked(tenantId, async (tx) => {
      await this.partner(tx, tenantId, dto.supplierId, 'isSupplier');
      const { lines, ...data } = dto;
      const newLines = await this.lines(tx, tenantId, lines, dto.supplierId, dto.currency);
      const order = await tx.supplierOrder.create({
        data: { ...data, tenantId, number, expectedDate: date(dto.expectedDate) },
      });
      await tx.supplierOrderLine.createMany({
        data: newLines.map((line) => ({ ...line, orderId: order.id })),
      });
      return this.total(
        await tx.supplierOrder.findFirstOrThrow({
          where: { tenantId, id: order.id },
          include: orderInclude,
        }),
      );
    });
  }
  updateOrder(tenantId: string, id: string, dto: UpdateSupplierOrderDto) {
    return this.locked(tenantId, async (tx) => {
      const old = this.found(await tx.supplierOrder.findFirst({ where: { tenantId, id } }));
      const { expectedUpdatedAt, lines, ...data } = dto;
      const updatedAt = this.version(old, expectedUpdatedAt);
      if (old.status !== 'DRAFT')
        throw new ConflictException('Seul un brouillon peut être modifié.');
      if (dto.supplierId !== old.supplierId && old.documentCoordinates)
        throw new ConflictException(
          'Retirez explicitement les coordonnées choisies avant de changer le fournisseur.',
        );
      await this.partner(tx, tenantId, dto.supplierId, 'isSupplier');
      const newLines = await this.lines(tx, tenantId, lines, dto.supplierId, dto.currency);
      await tx.supplierOrderLine.deleteMany({ where: { tenantId, orderId: id } });
      await tx.supplierOrderLine.createMany({ data: newLines.map((l) => ({ ...l, orderId: id })) });
      const written = await tx.supplierOrder.updateMany({
        where: { tenantId, id, status: 'DRAFT', updatedAt: old.updatedAt },
        data: { ...data, expectedDate: date(dto.expectedDate), updatedAt },
      });
      if (written.count !== 1) throw new ConflictException('La commande a changé. Rechargez-la.');
      return this.total(
        await tx.supplierOrder.findFirstOrThrow({ where: { tenantId, id }, include: orderInclude }),
      );
    });
  }
  async transitionOrder(
    tenantId: string,
    userId: string,
    id: string,
    dto: SupplierOrderTransitionDto,
  ) {
    const result = await this.locked(tenantId, async (tx) => {
      const old = this.found(
        await tx.supplierOrder.findFirst({ where: { tenantId, id }, include: orderInclude }),
      );
      const updatedAt = this.version(old, dto.expectedUpdatedAt);
      if (!canTransitionSupplierOrder(old.status as SupplierOrderStatus, dto.status))
        throw new ConflictException('Transition de commande interdite.');
      if (dto.status === 'CANCELLED' && old.lines.some((l) => l.receipts.length))
        throw new ConflictException(
          'Cette commande a des réceptions physiques. Clôturez le suivi avec un motif; annuler ne retournerait pas le stock.',
        );
      if (
        dto.status === 'CLOSED' &&
        old.lines.some(
          (l) =>
            l.catalogItem.kind === 'GOODS' &&
            new Prisma.Decimal(receiptProgress(l).remaining).gt(0),
        ) &&
        !dto.closeReason?.trim()
      )
        throw new ConflictException(
          'Il reste des produits à recevoir. Indiquez un motif pour clôturer ce reliquat sans créer de stock.',
        );
      if (dto.status === 'CONFIRMED') {
        await this.partner(tx, tenantId, old.supplierId, 'isSupplier');
        if (!old.lines.length) throw new BadRequestException('Ajoutez au moins une ligne.');
        for (const line of old.lines) await this.item(tx, tenantId, line.catalogItemId);
        for (const line of old.lines) {
          if (line.packageSnapshot) {
            const pack = line.packageSnapshot as unknown as CatalogPackageSnapshot;
            await capturePackage(
              tx,
              tenantId,
              line.catalogItemId,
              pack.packageId,
              pack.version,
              pack.orderedCount,
              line.quantity,
            );
          }
          if (!line.supplierTermsSnapshot) continue;
          const snapshot = line.supplierTermsSnapshot as unknown as SupplierTermsSnapshot;
          await captureSupplierTerms(tx, tenantId, {
            offerId: snapshot.offerId,
            version: snapshot.version,
            supplierId: old.supplierId,
            catalogItemId: line.catalogItemId,
            currency: old.currency,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          });
        }
      }
      const documentCoordinates =
        dto.status === 'CONFIRMED'
          ? await this.coordinates.freeze(tx, tenantId, old.documentCoordinates, {
              kind: 'supplier',
              id: old.supplierId,
            })
          : undefined;
      const written = await tx.supplierOrder.updateMany({
        where: { tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: {
          status: dto.status,
          updatedAt,
          ...(documentCoordinates ? { documentCoordinates } : {}),
          ...(dto.status === 'CLOSED' ? { closeReason: dto.closeReason ?? null } : {}),
        },
      });
      if (written.count !== 1) throw new ConflictException('La commande a changé. Rechargez-la.');
      return {
        before: old,
        after: this.total(
          await tx.supplierOrder.findFirstOrThrow({
            where: { tenantId, id },
            include: orderInclude,
          }),
        ),
      };
    });
    await this.audit.log({
      tenantId,
      userId,
      entityType: 'supplier-order',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      ...result,
    });
    return result.after;
  }
}
