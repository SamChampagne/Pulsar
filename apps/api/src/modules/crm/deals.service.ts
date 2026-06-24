import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, canTransitionDeal, CrmDealStage, CustomFieldEntity, dealAgeDays, isDealStale } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../core/custom-fields/custom-fields.service';
import { SequencesService } from '../../prisma/sequences.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { CreateDealDto, DealListQueryDto, UpdateDealDto } from './dto/deal.dto';

/**
 * CRM deals service. All operations are tenant-scoped (rule 1).
 * Stage transitions use canTransitionDeal from @pulsar/shared (rule 2).
 * Claim-safe updates via updateMany with optimistic stage lock (TOCTOU).
 * customData is validated via CustomFieldsService before persisting (rule 35).
 */
@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly sequences: SequencesService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(tenantId: string, query: DealListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmDeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.crmDeal.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const deal = await this.prisma.crmDeal.findFirst({
      where: { id, tenantId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    return deal;
  }

  async create(tenantId: string, userId: string, dto: CreateDealDto) {
    // Validate companyId is owned by this tenant (rule 9 — inline check like contacts)
    const company = await this.prisma.crmCompany.findFirst({
      where: { id: dto.companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);

    const customData = await this.customFields.validateValues(
      'crm', tenantId, CustomFieldEntity.CRM_DEAL, dto.customData, { partial: false },
    );

    const deal = await this.prisma.crmDeal.create({
      data: {
        tenantId,
        title: dto.title,
        companyId: dto.companyId,
        stage: dto.stage ?? CrmDealStage.LEAD,
        amount: dto.amount ?? null,
        currency: dto.currency ?? 'CAD',
        ownerUserId: dto.ownerUserId ?? null,
        expectedCloseDate: dto.expectedCloseDate ?? null,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-deal',
      entityId: deal.id,
      after: { title: deal.title, stage: deal.stage, companyId: deal.companyId },
    });

    return this.get(tenantId, deal.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateDealDto) {
    if (dto.companyId) {
      const company = await this.prisma.crmCompany.findFirst({
        where: { id: dto.companyId, tenantId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);
    }

    const customData = await this.customFields.validateValues(
      'crm', tenantId, CustomFieldEntity.CRM_DEAL, dto.customData, { partial: true },
    );

    const { count } = await this.prisma.crmDeal.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.companyId !== undefined ? { companyId: dto.companyId } : {}),
        // stage is NOT writable here — use POST :id/advance (rule 2)
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
        ...(dto.expectedCloseDate !== undefined ? { expectedCloseDate: dto.expectedCloseDate } : {}),
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM deal not found');

    const deal = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-deal',
      entityId: id,
      after: { title: deal.title, stage: deal.stage },
    });

    return deal;
  }

  /**
   * Advance a deal's stage. Guards with canTransitionDeal (rule 2).
   * Claim-safe: optimistic lock on current stage (TOCTOU).
   */
  async advance(tenantId: string, id: string, userId: string, toStage: CrmDealStage) {
    const deal = await this.prisma.crmDeal.findFirstOrThrow({ where: { id, tenantId } });
    if (!canTransitionDeal(deal.stage as CrmDealStage, toStage)) {
      throw new BadRequestException(`Cannot move deal from ${deal.stage} to ${toStage}`);
    }
    const res = await this.prisma.crmDeal.updateMany({
      where: { id, tenantId, stage: deal.stage }, // TOCTOU claim
      data: { stage: toStage },
    });
    if (res.count === 0) throw new BadRequestException('Deal changed concurrently; retry');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'crm-deal',
      entityId: id,
      before: { stage: deal.stage },
      after: { stage: toStage },
    });
    return this.get(tenantId, id);
  }

  /**
   * Convert a WON deal into a Customer. Creates or links the Customer record,
   * sets company.customerId + company.status=ACTIVE, records convertedCustomerId.
   */
  async convert(tenantId: string, id: string, userId: string) {
    const deal = await this.prisma.crmDeal.findFirstOrThrow({
      where: { id, tenantId },
      include: { company: true },
    });
    if (deal.stage !== CrmDealStage.WON) {
      throw new BadRequestException('Only WON deals can be converted');
    }
    return this.prisma.$transaction(async (tx) => {
      let customerId = deal.company.customerId;
      if (!customerId) {
        const code = await this.sequences.nextNumber(tenantId, 'customer');
        const customer = await tx.customer.create({
          data: { tenantId, code, name: deal.company.name },
        });
        customerId = customer.id;
        await tx.crmCompany.update({
          where: { id: deal.companyId, tenantId },
          data: { customerId, status: 'ACTIVE' },
        });
      }
      await tx.crmDeal.update({ where: { id }, data: { convertedCustomerId: customerId } });
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'crm-deal',
        entityId: id,
        before: { stage: deal.stage },
        after: { convertedCustomerId: customerId },
      });
      return { dealId: id, customerId };
    });
  }

  /**
   * Full context for a single deal — used by the coach agent (crm_get_deal).
   * Returns the deal, its company, the company's contacts, and the deal's recent activities.
   */
  async getWithContext(tenantId: string, id: string) {
    const deal = await this.prisma.crmDeal.findFirst({
      where: { id, tenantId },
      include: { company: { select: { id: true, name: true, domain: true, industry: true, status: true } } },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    const [contacts, activities] = await Promise.all([
      this.prisma.crmContact.findMany({
        where: { tenantId, companyId: deal.companyId },
        select: { id: true, name: true, title: true, email: true, phone: true },
      }),
      this.prisma.crmActivity.findMany({
        where: { tenantId, dealId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    return { deal, company: deal.company, contacts, activities };
  }

  /**
   * Pipeline view: deals grouped by stage, each with company name + amount + owner.
   */
  async pipeline(tenantId: string) {
    const deals = await this.prisma.crmDeal.findMany({
      where: { tenantId },
      orderBy: [{ stage: 'asc' }, { createdAt: 'desc' }],
      include: { company: { select: { id: true, name: true } } },
    });

    const stageOrder = [
      CrmDealStage.LEAD,
      CrmDealStage.QUALIFIED,
      CrmDealStage.PROPOSAL,
      CrmDealStage.WON,
      CrmDealStage.LOST,
    ];

    const byStage = new Map<CrmDealStage, typeof deals>();
    for (const stage of stageOrder) {
      byStage.set(stage, []);
    }
    for (const deal of deals) {
      const bucket = byStage.get(deal.stage as CrmDealStage);
      if (bucket) bucket.push(deal);
    }

    const now = new Date();
    return stageOrder.map((stage) => ({
      stage,
      deals: (byStage.get(stage) ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        companyName: d.company.name,
        amount: d.amount,
        currency: d.currency,
        ownerUserId: d.ownerUserId,
        lastActivityAt: d.lastActivityAt,
        expectedCloseDate: d.expectedCloseDate,
        ageDays: dealAgeDays(d.createdAt, now),
        stale: isDealStale({
          stage: d.stage as CrmDealStage,
          lastActivityAt: d.lastActivityAt,
          createdAt: d.createdAt,
          now,
        }),
      })),
    }));
  }
}
