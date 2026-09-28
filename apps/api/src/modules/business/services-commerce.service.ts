import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  ServiceQuoteStatus,
  canTransitionServiceQuote,
  serviceAcceptanceBlock,
  calendarDate,
  connectedOperationsSettings,
  hrAvailabilityDate,
  PERMISSIONS,
  PARTY_ACCESS,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentCoordinatesService } from '../../core/reference-data/document-coordinates.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { lockBusinessTenant, nextBusinessVersion } from './business-lock';
import { BusinessQueryDto, VersionDto } from './business.dto';
import {
  CreateServiceQuoteDto,
  InvoiceServiceWorkDto,
  PartnerLinksDto,
  QuoteFieldsDto,
  TransitionServiceQuoteDto,
  UpdateServiceQuoteDto,
} from './services-commerce.dto';
import type { CustomerInvoicesService } from '../billing/customer-invoices.service';
const hash = (actor: AuthUser, data: unknown) =>
  createHash('sha256')
    .update(JSON.stringify({ actor: actor.id, data }))
    .digest('hex');
const partnerSummary = { id: true, code: true, name: true } as const;
export type PartnerLinkConsumer = 'catalog' | 'services' | 'clients' | 'support' | 'purchasing';
const quoteInclude = {
  partner: { select: partnerSummary },
  project: { select: { id: true, number: true, status: true } },
} as const;

@Injectable()
export class ServicesCommerceService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly ref: ModuleRef,
    private readonly coordinates: DocumentCoordinatesService,
  ) {}
  private async access(actor: AuthUser, manage = false, billing = false) {
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    if (
      !enabled.has('services') ||
      !actor.permissions.includes(PERMISSIONS.SERVICES.READ) ||
      (manage && !actor.permissions.includes(PERMISSIONS.SERVICES.MANAGE))
    )
      throw new ForbiddenException();
    if (
      billing &&
      (!enabled.has('billing') ||
        !actor.permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ) ||
        (manage && !actor.permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)))
    )
      throw new ForbiddenException('Facturation et droits sur les factures client requis.');
  }
  private locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(
      async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        return fn(tx);
      },
      { timeout: 15000 },
    );
  }
  async billingCustomers(
    actor: AuthUser,
    query: BusinessQueryDto,
    consumer: 'catalog' | 'services' = 'catalog',
  ) {
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    if (
      !enabled.has(consumer) ||
      !enabled.has('billing') ||
      !actor.permissions.includes(
        consumer === 'services' ? PERMISSIONS.SERVICES.READ : PERMISSIONS.CATALOG.READ,
      ) ||
      !actor.permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
    )
      throw new ForbiddenException();
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.CustomerWhereInput = {
      tenantId: actor.tenantId,
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.customer.findMany({
        where,
        select: partnerSummary,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.db.customer.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  private async quoteData(tx: Prisma.TransactionClient, tenantId: string, dto: QuoteFieldsDto) {
    if (!dto.title.trim()) throw new BadRequestException('Titre du devis requis.');
    await this.ownership.assertOwned('businessPartner', dto.partnerId, tenantId, tx);
    const partner = await tx.businessPartner.findFirst({
      where: { tenantId, id: dto.partnerId, active: true, isCustomer: true },
    });
    if (!partner) throw new BadRequestException('Client actif requis.');
    const lines = [];
    for (const line of dto.lines) {
      await this.ownership.assertOwned('catalogItem', line.catalogItemId, tenantId, tx);
      const item = await tx.catalogItem.findFirst({
        where: { tenantId, id: line.catalogItemId, active: true },
        select: { name: true, unit: true },
      });
      if (!item) throw new BadRequestException('Article ou prestation inactif.');
      lines.push({ ...line, name: item.name, unit: item.unit });
    }
    const totalAmount = lines.reduce(
      (sum, l) => sum.add(new Prisma.Decimal(l.quantity).mul(l.unitPrice).toDecimalPlaces(2)),
      new Prisma.Decimal(0),
    );
    if (totalAmount.gt('9999999999.99') || totalAmount.lte(0))
      throw new BadRequestException('Montant total hors limites.');
    let validUntil: Date | null = null;
    if (dto.validUntil) {
      try {
        validUntil = calendarDate(dto.validUntil);
      } catch {
        throw new BadRequestException('Date de validité invalide.');
      }
    }
    return {
      partnerId: dto.partnerId,
      title: dto.title.trim(),
      currency: dto.currency,
      lines: lines as unknown as Prisma.InputJsonValue,
      totalAmount,
      validUntil,
    };
  }
  async quotes(actor: AuthUser, query: BusinessQueryDto) {
    await this.access(actor);
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.ServiceQuoteWhereInput = {
      tenantId: actor.tenantId,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { number: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.serviceQuote.findMany({
        where,
        skip,
        take,
        include: quoteInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.serviceQuote.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async quote(actor: AuthUser, id: string) {
    await this.access(actor);
    const row = await this.db.serviceQuote.findFirst({
      where: { tenantId: actor.tenantId, id },
      include: quoteInclude,
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async createQuote(actor: AuthUser, dto: CreateServiceQuoteDto) {
    await this.access(actor, true);
    const fingerprint = hash(actor, dto),
      number = await this.sequences.nextNumber(actor.tenantId, 'service-quote');
    const result = await this.locked(actor.tenantId, async (tx) => {
      const existing = await tx.serviceQuote.findFirst({
        where: { tenantId: actor.tenantId, operationKey: dto.operationKey },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne un autre devis.');
        return { id: existing.id, created: false };
      }
      const row = await tx.serviceQuote.create({
        data: {
          ...(await this.quoteData(tx, actor.tenantId, dto)),
          tenantId: actor.tenantId,
          number,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      return { id: row.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId: actor.tenantId,
        userId: actor.id,
        entityType: 'service-quote',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { number },
      });
    return this.quote(actor, result.id);
  }
  async updateQuote(actor: AuthUser, id: string, dto: UpdateServiceQuoteDto) {
    await this.access(actor, true);
    await this.locked(actor.tenantId, async (tx) => {
      const row = await tx.serviceQuote.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!row) throw new NotFoundException();
      if (row.status !== 'DRAFT')
        throw new ConflictException('Le devis accepté ou annulé est figé.');
      if (row.partnerId !== dto.partnerId && row.documentCoordinates)
        throw new ConflictException(
          'Retirez d’abord les coordonnées enregistrées avant de changer de client.',
        );
      await tx.serviceQuote.updateMany({
        where: { tenantId: actor.tenantId, id, updatedAt: row.updatedAt },
        data: {
          ...(await this.quoteData(tx, actor.tenantId, dto)),
          updatedAt: nextBusinessVersion(row, dto.expectedUpdatedAt),
        },
      });
    });
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      entityType: 'service-quote',
      entityId: id,
      action: AuditAction.UPDATE,
      after: { title: dto.title },
    });
    return this.quote(actor, id);
  }
  async transitionQuote(actor: AuthUser, id: string, dto: TransitionServiceQuoteDto) {
    await this.access(actor, true);
    const number =
      dto.status === 'ACCEPTED'
        ? await this.sequences.nextNumber(actor.tenantId, 'service-project')
        : '';
    const changed = await this.locked(actor.tenantId, async (tx) => {
      const row = await tx.serviceQuote.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!row) throw new NotFoundException();
      if (row.status === dto.status) return false;
      if (!canTransitionServiceQuote(row.status as ServiceQuoteStatus, dto.status))
        throw new ConflictException('Transition de devis interdite.');
      const updatedAt = nextBusinessVersion(row, dto.expectedUpdatedAt);
      let projectId: string | null = null;
      let documentCoordinates: Prisma.InputJsonObject | undefined;
      if (dto.status === 'ACCEPTED') {
        documentCoordinates = await this.coordinates.freeze(
          tx,
          actor.tenantId,
          row.documentCoordinates,
          { kind: 'partner', id: row.partnerId },
        );
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: actor.tenantId },
          select: { settings: true },
        });
        const zone = connectedOperationsSettings(
          (tenant.settings as Record<string, unknown>).connectedOperations,
        ).timeZone;
        if (
          row.validUntil &&
          row.validUntil.toISOString().slice(0, 10) <
            hrAvailabilityDate(new Date().toISOString(), zone)
        )
          throw new ConflictException(
            'Ce devis est expiré. Révisez le brouillon avant acceptation.',
          );
        if (
          !(await tx.businessPartner.findFirst({
            where: { tenantId: actor.tenantId, id: row.partnerId, active: true, isCustomer: true },
          }))
        )
          throw new ConflictException('Client inactif.');
        const project = await tx.serviceProject.create({
          data: {
            tenantId: actor.tenantId,
            number,
            title: row.title,
            partnerId: row.partnerId,
            description: `Issu du devis ${row.number}. Prix de devis figés, facturation à préparer sur les travaux réels.`,
          },
        });
        projectId = project.id;
      }
      await tx.serviceQuote.updateMany({
        where: { tenantId: actor.tenantId, id, status: 'DRAFT' },
        data: {
          status: dto.status,
          updatedAt,
          projectId,
          acceptedAt: dto.status === 'ACCEPTED' ? new Date() : null,
          ...(documentCoordinates ? { documentCoordinates } : {}),
        },
      });
      return true;
    });
    if (changed)
      await this.audit.log({
        tenantId: actor.tenantId,
        userId: actor.id,
        entityType: 'service-quote',
        entityId: id,
        action: AuditAction.STATUS_CHANGE,
        before: { status: 'DRAFT' },
        after: { status: dto.status },
      });
    return this.quote(actor, id);
  }
  async billable(actor: AuthUser, projectId: string) {
    await this.access(actor, false, true);
    const tenantId = actor.tenantId;
    return this.db.$transaction(
      async (tx) => {
        const project = await tx.serviceProject.findFirst({
          where: { tenantId, id: projectId },
          select: {
            id: true,
            number: true,
            acceptanceRequired: true,
            partner: { select: { ...partnerSummary, billingCustomerId: true } },
            quote: {
              select: { id: true, number: true, currency: true, lines: true, totalAmount: true },
            },
          },
        });
        if (!project) throw new NotFoundException();
        const timeWhere = {
          tenantId,
          job: { tenantId, projectId },
          status: 'APPROVED' as const,
          billable: true,
          billingLine: null,
        };
        const partWhere = {
          tenantId,
          job: { tenantId, projectId },
          returnedQuantity: { lt: tx.servicePartUsage.fields.quantity },
          billingLine: null,
        };
        const [times, parts, timeCount, partCount, invoices] = await Promise.all([
          tx.serviceTimeEntry.findMany({
            where: timeWhere,
            take: 100,
            orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              minutes: true,
              workDate: true,
              updatedAt: true,
              job: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  status: true,
                  acceptanceStatus: true,
                },
              },
            },
          }),
          tx.servicePartUsage.findMany({
            where: partWhere,
            take: 100,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              quantity: true,
              returnedQuantity: true,
              updatedAt: true,
              nameSnapshot: true,
              unitSnapshot: true,
              createdAt: true,
              job: { select: { id: true, number: true, status: true, acceptanceStatus: true } },
            },
          }),
          tx.serviceTimeEntry.count({ where: timeWhere }),
          tx.servicePartUsage.count({ where: partWhere }),
          tx.serviceInvoiceBatch.findMany({
            where: { tenantId, projectId },
            select: {
              id: true,
              createdAt: true,
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  status: true,
                  currency: true,
                  totalAmount: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
        ]);
        return {
          project,
          sources: [
            ...times.map((t) => ({
              kind: 'time' as const,
              id: t.id,
              jobId: t.job.id,
              blockedReason: serviceAcceptanceBlock(project.acceptanceRequired, t.job),
              label: `${t.job.number} · ${t.minutes} min · ${t.workDate.toISOString().slice(0, 10)}`,
              quantity: new Prisma.Decimal(t.minutes).div(60).toString(),
              unit: 'H',
              expectedVersion: t.updatedAt.toISOString(),
            })),
            ...parts.map((p) => ({
              kind: 'part' as const,
              id: p.id,
              jobId: p.job.id,
              blockedReason: serviceAcceptanceBlock(project.acceptanceRequired, p.job),
              label: `${p.job.number} · ${p.nameSnapshot}`,
              quantity: p.quantity.minus(p.returnedQuantity).toString(),
              issuedQuantity: p.quantity.toString(),
              returnedQuantity: p.returnedQuantity.toString(),
              unit: p.unitSnapshot,
              expectedVersion: p.updatedAt.toISOString(),
            })),
          ],
          remainingSources: timeCount + partCount,
          truncated: timeCount > times.length || partCount > parts.length,
          invoices,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async invoice(actor: AuthUser, projectId: string, dto: InvoiceServiceWorkDto) {
    await this.access(actor, true, true);
    const tenantId = actor.tenantId,
      fingerprint = hash(actor, { projectId, ...dto });
    if (new Set(dto.sources.map((s) => s.kind + ':' + s.id)).size !== dto.sources.length)
      throw new BadRequestException('Source répétée.');
    const invoiceNumber = await this.sequences.nextNumber(tenantId, 'customer-invoice');
    const billing = this.ref.get<CustomerInvoicesService>(
      require('../billing/customer-invoices.service').CustomerInvoicesService,
      { strict: false },
    );
    const result = await this.locked(tenantId, async (tx) => {
      const existing = await tx.serviceInvoiceBatch.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne une autre facturation.');
        if (!existing.invoiceId)
          throw new ConflictException(
            'Le brouillon a été supprimé. Inspectez les sources avant une nouvelle demande.',
          );
        return { id: existing.invoiceId, created: false };
      }
      await this.ownership.assertOwned('serviceProject', projectId, tenantId, tx);
      const project = await tx.serviceProject.findFirstOrThrow({
        where: { tenantId, id: projectId },
        include: { partner: true },
      });
      if (
        project.status === 'CANCELLED' ||
        !project.partner.active ||
        !project.partner.billingCustomerId
      )
        throw new ConflictException(
          'Projet non annulé et client actif relié à Facturation requis.',
        );
      const lines = [];
      for (const source of dto.sources) {
        if (source.kind === 'time') {
          await this.ownership.assertOwned('serviceTimeEntry', source.id, tenantId, tx);
          const time = await tx.serviceTimeEntry.findFirst({
            where: {
              tenantId,
              id: source.id,
              job: { tenantId, projectId },
              status: 'APPROVED',
              billable: true,
              billingLine: null,
            },
            include: { job: { select: { number: true, status: true, acceptanceStatus: true } } },
          });
          if (!time || time.updatedAt.toISOString() !== source.expectedVersion)
            throw new ConflictException(
              'Une heure a changé, a déjà été facturée ou n’est plus approuvée.',
            );
          const block = serviceAcceptanceBlock(project.acceptanceRequired, time.job);
          if (block) throw new ConflictException(`${time.job.number} : ${block}`);
          lines.push({
            description: `${time.job.number} · ${time.minutes} minutes approuvées du ${time.workDate.toISOString().slice(0, 10)}`,
            quantity: new Prisma.Decimal(time.minutes).div(60),
            unitPrice: new Prisma.Decimal(source.unitPrice),
            serviceTimeEntryId: time.id,
            servicePartUsageId: null,
            sourceVersion: source.expectedVersion,
            unit: 'H',
          });
        } else {
          await this.ownership.assertOwned('servicePartUsage', source.id, tenantId, tx);
          const part = await tx.servicePartUsage.findFirst({
            where: {
              tenantId,
              id: source.id,
              job: { tenantId, projectId },
              returnedQuantity: { lt: tx.servicePartUsage.fields.quantity },
              billingLine: null,
            },
            include: { job: { select: { number: true, status: true, acceptanceStatus: true } } },
          });
          if (!part || part.updatedAt.toISOString() !== source.expectedVersion)
            throw new ConflictException('Une pièce a été retournée, facturée ou modifiée.');
          const block = serviceAcceptanceBlock(project.acceptanceRequired, part.job);
          if (block) throw new ConflictException(`${part.job.number} : ${block}`);
          lines.push({
            description: `${part.job.number} · ${part.nameSnapshot}`,
            quantity: part.quantity.minus(part.returnedQuantity),
            unitPrice: new Prisma.Decimal(source.unitPrice),
            serviceTimeEntryId: null,
            servicePartUsageId: part.id,
            sourceVersion: source.expectedVersion,
            unit: part.unitSnapshot,
          });
        }
      }
      const invoice = await billing.createDraftFromServiceWork(tx, {
        tenantId,
        customerId: project.partner.billingCustomerId,
        invoiceNumber,
        currency: dto.currency,
        projectId,
        projectNumber: project.number,
        lines,
      });
      await tx.serviceInvoiceBatch.create({
        data: {
          tenantId,
          projectId,
          invoiceId: invoice.id,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      return { id: invoice.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        entityType: 'customer-invoice',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { source: 'services', projectId, invoiceNumber, sources: dto.sources.length },
      });
    return { invoiceId: result.id, created: result.created };
  }

  async partnerLinks(
    actor: AuthUser,
    id: string,
    dto?: PartnerLinksDto,
    consumer: PartnerLinkConsumer = 'catalog',
    review?: { reason: string; confirm: boolean; token?: string },
  ) {
    const tenantId = actor.tenantId,
      enabled = await this.modules.getEnabledKeys(tenantId);
    const grant = PARTY_ACCESS.find(
      (a) => a.module === consumer && ['client', 'supplier', 'partner'].includes(a.kind),
    );
    if (
      !grant ||
      !enabled.has(consumer) ||
      !actor.permissions.includes(grant.read) ||
      (dto && !actor.permissions.includes(grant.manage))
    )
      throw new ForbiddenException();
    const billing = PARTY_ACCESS.some(
      (a) => a.kind === 'customer' && enabled.has(a.module) && actor.permissions.includes(a.read),
    );
    const crm = enabled.has('crm') && actor.permissions.includes(PERMISSIONS.CRM.READ);
    const row = await this.locked(tenantId, async (tx) => {
      const old = await tx.businessPartner.findFirst({
        where: {
          tenantId,
          id,
          ...(consumer === 'catalog'
            ? {}
            : consumer === 'purchasing'
              ? { isSupplier: true }
              : { isCustomer: true }),
        },
      });
      if (!old) throw new NotFoundException();
      if (dto) {
        if (
          (dto.billingCustomerId !== undefined && !billing) ||
          (dto.crmCompanyId !== undefined && !crm)
        )
          throw new ForbiddenException('Droit de lecture de la cible requis.');
        // Customer's historical writers use row locks, not the business advisory lock.
        if (dto.billingCustomerId)
          await tx.$queryRaw`SELECT id FROM customers WHERE "tenantId" = ${tenantId} AND id = ${dto.billingCustomerId} FOR SHARE`;
        if (dto.billingCustomerId)
          await this.ownership.assertOwned('customer', dto.billingCustomerId, tenantId, tx);
        if (dto.crmCompanyId)
          await this.ownership.assertOwned('crmCompany', dto.crmCompanyId, tenantId, tx);
        if (
          dto.billingCustomerId !== undefined &&
          dto.billingCustomerId !== old.billingCustomerId &&
          (await tx.serviceInvoiceBatch.count({
            where: { tenantId, project: { tenantId, partnerId: id } },
          }))
        )
          throw new ConflictException(
            'Le client de facturation est déjà utilisé dans l’historique Services.',
          );
        if (
          dto.billingCustomerId &&
          !(await tx.customer.findFirst({
            where: { tenantId, id: dto.billingCustomerId, isActive: true },
          }))
        )
          throw new ConflictException('Client de facturation inactif.');
        const companyId = dto.crmCompanyId === undefined ? old.crmCompanyId : dto.crmCompanyId;
        const customerId =
          dto.billingCustomerId === undefined ? old.billingCustomerId : dto.billingCustomerId;
        const company = companyId
          ? await tx.crmCompany.findFirst({
              where: { tenantId, id: companyId },
              select: { customerId: true, updatedAt: true, id: true, name: true },
            })
          : null;
        if (company?.customerId && company.customerId !== customerId)
          throw new ConflictException(
            'La société CRM possède déjà un autre lien client. Choisissez le même client de facturation.',
          );
        if (review) {
          // Review is read-only. Confirm re-reads the same facts under the same tenant lock.
          nextBusinessVersion(old, dto.expectedUpdatedAt);
          if (customerId && dto.billingCustomerId === undefined)
            await tx.$queryRaw`SELECT id FROM customers WHERE "tenantId" = ${tenantId} AND id = ${customerId} FOR SHARE`;
          const customer = customerId
            ? await tx.customer.findFirst({
                where: { tenantId, id: customerId },
                select: { id: true, name: true, updatedAt: true },
              })
            : null;
          const reviewToken = hash(actor, {
            owner: { id, updatedAt: old.updatedAt },
            dto,
            customer,
            company,
            reason: review.reason,
          });
          if (review.confirm && review.token !== reviewToken)
            throw new ConflictException(
              'Le rapprochement a changé depuis la revue. Vérifiez à nouveau.',
            );
          if (!review.confirm)
            return {
              reviewToken,
              customer: billing ? customer : undefined,
              company:
                crm && company
                  ? { id: company.id, name: company.name, updatedAt: company.updatedAt }
                  : undefined,
              updatedAt: old.updatedAt,
              preview: true as const,
            };
        }
        const { expectedUpdatedAt, ...data } = dto;
        try {
          await tx.businessPartner.updateMany({
            where: { tenantId, id },
            data: { ...data, updatedAt: nextBusinessVersion(old, expectedUpdatedAt) },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
            throw new ConflictException('Cette cible est déjà reliée à un partenaire.');
          throw e;
        }
      }
      return tx.businessPartner.findFirstOrThrow({ where: { tenantId, id } });
    });
    if ('preview' in row) return row;
    if (review?.confirm)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: 'party-identity-review',
        entityId: id,
        after: { reason: review.reason, changes: dto, updatedAt: row.updatedAt },
      });
    return {
      id,
      updatedAt: row.updatedAt,
      ...(billing ? { billingCustomerId: row.billingCustomerId } : {}),
      ...(crm ? { crmCompanyId: row.crmCompanyId } : {}),
    };
  }
  async createBillingCustomer(
    actor: AuthUser,
    id: string,
    dto: VersionDto,
    consumer: 'catalog' | 'services' = 'catalog',
  ) {
    const tenantId = actor.tenantId,
      enabled = await this.modules.getEnabledKeys(tenantId);
    if (
      !enabled.has(consumer) ||
      !enabled.has('billing') ||
      !actor.permissions.includes(
        consumer === 'services' ? PERMISSIONS.SERVICES.MANAGE : PERMISSIONS.CATALOG.MANAGE,
      ) ||
      !actor.permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
    )
      throw new ForbiddenException();
    const code = await this.sequences.nextNumber(tenantId, 'customer');
    return this.locked(tenantId, async (tx) => {
      const partner = await tx.businessPartner.findFirst({
        where: { tenantId, id, active: true, isCustomer: true },
      });
      if (!partner) throw new NotFoundException('Client actif introuvable.');
      if (partner.billingCustomerId)
        return { customerId: partner.billingCustomerId, created: false };
      const updatedAt = nextBusinessVersion(partner, dto.expectedUpdatedAt);
      if (partner.crmCompanyId) {
        const company = await tx.crmCompany.findFirst({
          where: { tenantId, id: partner.crmCompanyId },
          select: { customerId: true },
        });
        if (company?.customerId)
          throw new ConflictException('Utilisez le client déjà relié à la société CRM.');
      }
      const customer = await tx.customer.create({
        data: { tenantId, code, name: partner.name, email: partner.email, phone: partner.phone },
      });
      await tx.businessPartner.updateMany({
        where: { tenantId, id },
        data: { billingCustomerId: customer.id, updatedAt },
      });
      return { customerId: customer.id, created: true };
    });
  }
}
