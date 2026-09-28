import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  canMoveCrmStage,
  CrmDealStage,
  CustomFieldEntity,
  dealAgeDays,
  isDealStale,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../core/custom-fields/custom-fields.service';
import { SequencesService } from '../../prisma/sequences.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { CreateDealDto, DealListQueryDto, UpdateDealDto } from './dto/deal.dto';
import { PipelinesService } from './pipelines.service';
import { SequencesService as CommunicationsService } from './sequences.service';
import { lockBusinessTenant } from '../business/business-lock';
import { assertCompanyCustomerLink } from '../business/identity-links';

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
    private readonly domainEvents: DomainEventsService,
    private readonly pipelines: PipelinesService,
    private readonly communications: CommunicationsService,
  ) {}

  async list(tenantId: string, query: DealListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
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
      include: {
        company: { select: { id: true, name: true } },
        pipeline: { select: { id: true, name: true } },
        pipelineStage: { select: { id: true, name: true } },
      },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    const entries = await this.prisma.crmStageEntry.findMany({
      where: { tenantId, dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        stageId: true,
        createdAt: true,
        processedAt: true,
        reason: true,
        runId: true,
      },
    });
    return { ...deal, stageEntries: entries };
  }

  private async validateContact(tenantId: string, companyId: string, contactId?: string | null) {
    if (!contactId) return;
    const contact = await this.prisma.crmContact.findFirst({
      where: { tenantId, id: contactId, companyId },
      select: { id: true },
    });
    if (!contact)
      throw new BadRequestException('Le contact principal doit appartenir à cette entreprise CRM');
  }

  private async recordEntry(
    tx: Prisma.TransactionClient,
    deal: {
      id: string;
      tenantId: string;
      pipelineStageId: string | null;
      stageRevision: number;
      primaryContactId: string | null;
    },
    userId: string,
  ) {
    if (!deal.pipelineStageId) return;
    const sequence = await tx.crmSequence.findFirst({
      where: {
        tenantId: deal.tenantId,
        pipelineStageId: deal.pipelineStageId,
        enabled: true,
        trigger: 'DEAL_STAGE_ENTERED',
      },
    });
    await tx.crmStageEntry.create({
      data: {
        tenantId: deal.tenantId,
        dealId: deal.id,
        stageId: deal.pipelineStageId,
        revision: deal.stageRevision,
        contactId: deal.primaryContactId,
        userId,
        sequenceId: sequence?.id,
        ...(sequence
          ? {
              sequenceSnapshot: {
                mode: sequence.mode,
                agentId: sequence.agentId,
                steps: sequence.steps,
              } as Prisma.InputJsonValue,
            }
          : {}),
        ...(!sequence
          ? { processedAt: new Date(), reason: 'Aucune automatisation active à l’entrée' }
          : {}),
      },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateDealDto) {
    // Validate companyId is owned by this tenant (rule 9 — inline check like contacts)
    const company = await this.prisma.crmCompany.findFirst({
      where: { id: dto.companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);

    await this.validateContact(tenantId, dto.companyId, dto.primaryContactId);
    const column = await this.pipelines.resolveStage(tenantId, {
      pipelineId: dto.pipelineId,
      stageId: dto.pipelineStageId,
      kind: dto.stage,
    });
    if (dto.stage && dto.stage !== column.kind)
      throw new BadRequestException('La phase métier ne correspond pas à la colonne');

    const customData = await this.customFields.validateValues(
      'crm',
      tenantId,
      CustomFieldEntity.CRM_DEAL,
      dto.customData,
      { partial: false },
    );

    const deal = await this.prisma.$transaction(async (tx) => {
      // Serialize moves and configuration changes for this pipeline.
      await tx.crmPipeline.updateMany({
        where: { id: column.pipelineId, tenantId },
        data: { updatedAt: new Date() },
      });
      const currentColumn = await tx.crmPipelineStage.findFirst({
        where: { id: column.id, tenantId, archived: false },
      });
      if (!currentColumn) throw new BadRequestException('Cette colonne a été retirée');
      const created = await tx.crmDeal.create({
        data: {
          tenantId,
          title: dto.title,
          companyId: dto.companyId,
          stage: column.kind,
          pipelineId: column.pipelineId,
          pipelineStageId: column.id,
          primaryContactId: dto.primaryContactId ?? null,
          amount: dto.amount ?? null,
          currency: dto.currency ?? 'CAD',
          ownerUserId: dto.ownerUserId ?? null,
          expectedCloseDate: dto.expectedCloseDate ?? null,
          ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
        },
      });
      await this.recordEntry(tx, created, userId);
      return created;
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
    const current = await this.get(tenantId, id);
    await this.validateContact(
      tenantId,
      dto.companyId ?? current.companyId,
      dto.primaryContactId !== undefined ? dto.primaryContactId : current.primaryContactId,
    );
    if (dto.companyId) {
      const company = await this.prisma.crmCompany.findFirst({
        where: { id: dto.companyId, tenantId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);
    }

    const customData = await this.customFields.validateValues(
      'crm',
      tenantId,
      CustomFieldEntity.CRM_DEAL,
      dto.customData,
      { partial: true },
    );
    const recipientChanged =
      (dto.primaryContactId !== undefined && dto.primaryContactId !== current.primaryContactId) ||
      (dto.companyId !== undefined && dto.companyId !== current.companyId);

    const { count } = await this.prisma.crmDeal.updateMany({
      where: {
        id,
        tenantId,
        companyId: current.companyId,
        primaryContactId: current.primaryContactId,
        stageRevision: current.stageRevision,
      },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.companyId !== undefined ? { companyId: dto.companyId } : {}),
        ...(dto.primaryContactId !== undefined ? { primaryContactId: dto.primaryContactId } : {}),
        // Invalidate the entry permanently, even if the original contact is restored later.
        ...(recipientChanged ? { stageRevision: { increment: 1 } } : {}),
        // stage is NOT writable here — use POST :id/advance (rule 2)
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
        ...(dto.expectedCloseDate !== undefined
          ? { expectedCloseDate: dto.expectedCloseDate }
          : {}),
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM deal not found');
    if (recipientChanged)
      await this.communications.stopDealRuns(tenantId, id).catch(() => undefined);

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
  async advance(
    tenantId: string,
    id: string,
    userId: string,
    toStage?: CrmDealStage,
    pipelineStageId?: string,
    expectedRevision?: number,
  ) {
    if ((!toStage && !pipelineStageId) || (toStage && pipelineStageId))
      throw new BadRequestException('Indiquez une seule colonne cible');
    const deal = await this.prisma.crmDeal.findFirstOrThrow({
      where: { id, tenantId },
    });
    const column = await this.pipelines.resolveStage(tenantId, {
      pipelineId: deal.pipelineId,
      stageId: pipelineStageId,
      kind: toStage,
    });
    // Legacy records belong to the default pipeline until their first move.
    if (
      !deal.pipelineId &&
      column.pipelineId !== (await this.pipelines.defaultPipeline(tenantId)).id
    )
      throw new BadRequestException('La colonne cible doit rester dans le même pipeline');
    const fromId =
      deal.pipelineStageId ??
      (await this.pipelines.resolveStage(tenantId, { kind: deal.stage as CrmDealStage })).id;
    if (
      !canMoveCrmStage(
        { id: fromId, kind: deal.stage as CrmDealStage },
        { id: column.id, kind: column.kind as CrmDealStage },
      )
    ) {
      throw new BadRequestException(`Cannot move deal from ${deal.stage} to ${column.kind}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.crmPipeline.updateMany({
        where: { tenantId, id: column.pipelineId },
        data: { updatedAt: new Date() },
      });
      if (
        !(await tx.crmPipelineStage.findFirst({
          where: { tenantId, id: column.id, archived: false },
        }))
      )
        throw new BadRequestException('Cette colonne a été retirée');
      const res = await tx.crmDeal.updateMany({
        where: {
          id,
          tenantId,
          stage: deal.stage,
          pipelineStageId: deal.pipelineStageId,
          stageRevision: expectedRevision ?? deal.stageRevision,
        },
        data: {
          stage: column.kind,
          pipelineId: column.pipelineId,
          pipelineStageId: column.id,
          stageRevision: { increment: 1 },
        },
      });
      if (!res.count) throw new BadRequestException('Deal changed concurrently; retry');
      const moved = await tx.crmDeal.findFirstOrThrow({ where: { id, tenantId } });
      await this.recordEntry(tx, moved, userId);
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'crm-deal',
      entityId: id,
      before: { stage: deal.stage, pipelineStageId: deal.pipelineStageId },
      after: { stage: column.kind, pipelineStageId: column.id },
    });
    // Immediate cleanup is best-effort; the delivery guard is the final enforcement point.
    await this.communications.stopDealRuns(tenantId, id).catch(() => undefined);
    if (column.kind === CrmDealStage.WON) {
      await this.domainEvents.emit(
        tenantId,
        'crm.deal.won',
        { type: 'deal', id },
        { dealId: id, companyId: deal.companyId },
      );
    }
    return this.get(tenantId, id);
  }

  /**
   * Convert a WON deal into a Customer. Creates or links the Customer record,
   * sets company.customerId + company.status=ACTIVE, records convertedCustomerId.
   */
  async convert(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      const deal = await tx.crmDeal.findFirstOrThrow({
        where: { id, tenantId },
        include: { company: true },
      });
      if (deal.stage !== CrmDealStage.WON)
        throw new BadRequestException('Only WON deals can be converted');
      // Conversion provenance is historical; a later company mapping never rewrites it.
      if (deal.convertedCustomerId) return { dealId: id, customerId: deal.convertedCustomerId };
      await assertCompanyCustomerLink(tx, tenantId, deal.companyId, deal.company.customerId);
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
      await tx.crmDeal.update({
        where: { id, tenantId },
        data: { convertedCustomerId: customerId },
      });
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
      include: {
        company: { select: { id: true, name: true, domain: true, industry: true, status: true } },
      },
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
    const pipeline = deal.pipelineId
      ? await this.pipelines.get(tenantId, deal.pipelineId)
      : await this.pipelines.defaultPipeline(tenantId);
    return {
      deal,
      company: deal.company,
      contacts,
      activities,
      pipeline: {
        id: pipeline.id,
        name: pipeline.name,
        stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
      },
    };
  }

  /**
   * Pipeline view: deals grouped by stage, each with company name + amount + owner.
   */
  async pipeline(tenantId: string, pipelineId?: string) {
    const pipeline = pipelineId
      ? await this.pipelines.get(tenantId, pipelineId)
      : await this.pipelines.defaultPipeline(tenantId);
    const deals = await this.prisma.crmDeal.findMany({
      where: {
        tenantId,
        OR: [
          { pipelineId: pipeline.id },
          ...(pipeline.key === 'default' ? [{ pipelineId: null }] : []),
        ],
      },
      orderBy: [{ stage: 'asc' }, { createdAt: 'desc' }],
      include: { company: { select: { id: true, name: true } } },
    });

    const automations = await this.prisma.crmSequence.findMany({
      where: { tenantId, pipelineStageId: { in: pipeline.stages.map((s) => s.id) } },
      select: {
        id: true,
        name: true,
        enabled: true,
        mode: true,
        steps: true,
        agentId: true,
        pipelineStageId: true,
      },
    });
    const owners = await this.prisma.user.findMany({
      where: { tenantId, id: { in: deals.flatMap((d) => (d.ownerUserId ? [d.ownerUserId] : [])) } },
      select: { id: true, firstName: true, lastName: true },
    });

    const now = new Date();
    return pipeline.stages.map((column) => ({
      stage: column.kind,
      id: column.id,
      name: column.name,
      pipelineId: pipeline.id,
      automation: automations.find((a) => a.pipelineStageId === column.id) ?? null,
      deals: deals
        .filter((d) =>
          d.pipelineStageId
            ? d.pipelineStageId === column.id
            : pipeline.stages.find((s) => s.kind === d.stage)?.id === column.id,
        )
        .map((d) => ({
          id: d.id,
          title: d.title,
          companyName: d.company.name,
          companyId: d.companyId,
          primaryContactId: d.primaryContactId,
          stageRevision: d.stageRevision,
          ownerName:
            owners
              .filter((u) => u.id === d.ownerUserId)
              .map((u) => `${u.firstName} ${u.lastName}`.trim())[0] ?? null,
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
