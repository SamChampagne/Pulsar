import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type QualityInspection } from '@pulsar/database';
import {
  AuditAction,
  type AuthUser,
  type PermissionKey,
  type QualityCriterion,
  QualityInspectionStatus,
  QualityNonconformityStatus,
  canTransitionQualityInspection,
  canTransitionQualityNonconformity,
  validateQualityCriteria,
  evaluateQualityResults,
  calendarDate,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import {
  lockBusinessTenant,
  nextBusinessVersion,
  assertServicePerson,
  servicePersonSelect,
} from '../business/business-lock';
import { DocumentsService } from '../../core/documents/documents.service';
import { validateQualityEvidence } from './quality-evidence';
import {
  CreatePlanDto,
  UpdatePlanDto,
  QualityQueryDto,
  CreateInspectionDto,
  ResultsDto,
  InspectionTransitionDto,
  NonconformityUpdateDto,
  NonconformityTransitionDto,
  QualityAssignmentDto,
  QualityEvidenceDto,
} from './quality.dto';
const planSelect = {
  id: true,
  code: true,
  name: true,
  instructions: true,
  criteria: true,
  revision: true,
  active: true,
  updatedAt: true,
} as const;
const ncSelect = {
  assigneeUserId: true,
  assignee: { select: servicePersonSelect },
  dueDate: true,
  id: true,
  number: true,
  title: true,
  inspectionId: true,
  status: true,
  rootCause: true,
  correctiveAction: true,
  updatedAt: true,
  createdAt: true,
} as const;
const sourceRules: Record<string, { module: string; permission: PermissionKey }> = {
  LOT: { module: 'wms', permission: 'wms.read' },
  RECEIPT: { module: 'wms', permission: 'wms.read' },
  MANUFACTURING: { module: 'manufacturing', permission: 'manufacturing.read' },
  SUPPORT: { module: 'support', permission: 'support.read' },
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const checked = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new BadRequestException(e instanceof Error ? e.message : 'Valeur invalide.');
  }
};
const sourceKind = (r: QualityInspection) =>
  r.lotId
    ? 'LOT'
    : r.receiptId
      ? 'RECEIPT'
      : r.manufacturingOrderId
        ? 'MANUFACTURING'
        : r.supportCaseId
          ? 'SUPPORT'
          : 'MANUAL';
// Projection used by history: never copy internal tokens or cross-module references into events.
const snapshot = (r: QualityInspection) => ({
  status: r.status,
  outcome: r.outcome,
  results: r.results,
});
@Injectable()
export class QualityService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly documents: DocumentsService,
  ) {}
  async people(tenantId: string, q: QualityQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.UserWhereInput = {
        tenantId,
        status: 'ACTIVE',
        agentServiceFor: { none: {} },
        NOT: { email: 'service-account@pulsar.local' },
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
              ],
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
      rows.map((r) => ({ ...r, name: `${r.firstName} ${r.lastName}` })),
      total,
      page,
      pageSize,
    );
  }
  async assign(u: AuthUser, id: string, dto: QualityAssignmentDto) {
    const dueDate = dto.dueDate === null ? null : checked(() => calendarDate(dto.dueDate));
    const change = await this.locked(u.tenantId, async (tx) => {
      const old = await tx.qualityNonconformity.findFirst({
        where: { tenantId: u.tenantId, id },
        select: ncSelect,
      });
      if (!old) throw new NotFoundException('Non-conformité introuvable.');
      if (old.status === 'CLOSED') throw new ConflictException('La non-conformité est clôturée.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (dto.assigneeUserId)
        await assertServicePerson(tx, this.ownership, u.tenantId, dto.assigneeUserId);
      const row = await tx.qualityNonconformity.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: { assigneeUserId: dto.assigneeUserId, dueDate, updatedAt },
        select: ncSelect,
      });
      await this.event(
        tx,
        u,
        old.inspectionId,
        'NC_ASSIGNMENT',
        'Responsable et échéance actualisés',
        old,
        row,
      );
      return { before: old, after: row };
    });
    await this.log(u, change.after.inspectionId, AuditAction.UPDATE, change.before, change.after);
    return change.after;
  }
  async evidence(u: AuthUser, id: string) {
    await this.nonconformity(u.tenantId, id);
    return this.db.qualityEvidence.findMany({
      where: { tenantId: u.tenantId, nonconformityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        caption: true,
        createdAt: true,
        document: {
          select: {
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            uploadedBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }
  async evidenceDownload(u: AuthUser, id: string, evidenceId: string) {
    const row = await this.db.qualityEvidence.findFirst({
      where: { tenantId: u.tenantId, id: evidenceId, nonconformityId: id },
      select: { documentId: true },
    });
    if (!row) throw new NotFoundException('Preuve introuvable.');
    return this.documents.download(u.tenantId, row.documentId, 'quality-evidence');
  }
  private async discardEvidenceUpload(tenantId: string, documentId: string) {
    try {
      if (!(await this.db.qualityEvidence.count({ where: { tenantId, documentId } })))
        await this.documents.remove(tenantId, documentId, 'quality-evidence');
    } catch {
      await this.audit.log({
        tenantId,
        entityType: 'quality-evidence',
        entityId: documentId,
        action: AuditAction.UPDATE,
        after: { cleanupRequired: true },
      });
    }
  }
  async uploadEvidence(
    u: AuthUser,
    id: string,
    dto: QualityEvidenceDto,
    input?: Express.Multer.File,
  ) {
    const file = validateQualityEvidence(input),
      fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            u.id,
            id,
            dto.caption,
            file.originalname,
            file.mimetype,
            createHash('sha256').update(file.buffer).digest('hex'),
          ]),
        )
        .digest('hex');
    const preflight = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.qualityEvidence.findFirst({
        where: { tenantId: u.tenantId, operationKey: dto.operationKey },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne une autre preuve.');
        return existing;
      }
      const row = await tx.qualityNonconformity.findFirst({ where: { tenantId: u.tenantId, id } });
      if (!row) throw new NotFoundException('Non-conformité introuvable.');
      if (row.status === 'CLOSED')
        throw new ConflictException(
          'Une clôture est définitive; aucune nouvelle preuve ne peut être ajoutée.',
        );
      nextBusinessVersion(row, dto.expectedUpdatedAt);
      if (
        (await tx.qualityEvidence.count({
          where: { tenantId: u.tenantId, nonconformityId: id },
        })) >= 30
      )
        throw new ConflictException('Maximum de 30 preuves par non-conformité.');
      return null;
    };
    const previous = await this.locked(u.tenantId, preflight);
    if (previous)
      return {
        id: previous.id,
        replayed: true,
        nonconformity: await this.nonconformity(u.tenantId, id),
      };
    const document = await this.documents.upload(
      u.tenantId,
      {
        entityType: 'quality-evidence',
        entityId: id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        body: file.buffer,
        uploadedById: u.id,
      },
      'quality-evidence',
    );
    try {
      const result = await this.locked(u.tenantId, async (tx) => {
        const replay = await preflight(tx);
        if (replay) return { id: replay.id, replayed: true };
        const old = await tx.qualityNonconformity.findFirstOrThrow({
          where: { tenantId: u.tenantId, id },
        });
        // The document was created server-side for this actor and NC, never accepted by id from the caller.
        const proof = await tx.qualityEvidence.create({
          data: {
            tenantId: u.tenantId,
            nonconformityId: id,
            documentId: document.id,
            caption: dto.caption,
            operationKey: dto.operationKey,
            fingerprint,
          },
        });
        await tx.qualityNonconformity.update({
          where: { tenantId_id: { tenantId: u.tenantId, id } },
          data: { updatedAt: nextBusinessVersion(old, dto.expectedUpdatedAt) },
        });
        await this.event(tx, u, old.inspectionId, 'NC_EVIDENCE', dto.caption, null, {
          evidenceId: proof.id,
          fileName: document.fileName,
          sizeBytes: document.sizeBytes,
        });
        return { id: proof.id, replayed: false };
      });
      if (result.replayed) await this.discardEvidenceUpload(u.tenantId, document.id);
      else
        await this.audit.log({
          tenantId: u.tenantId,
          userId: u.id,
          entityType: 'quality-evidence',
          entityId: result.id,
          action: AuditAction.CREATE,
          after: { nonconformityId: id, caption: dto.caption },
        });
      return { ...result, nonconformity: await this.nonconformity(u.tenantId, id) };
    } catch (e) {
      await this.discardEvidenceUpload(u.tenantId, document.id);
      throw e;
    }
  }
  private locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      return fn(tx);
    });
  }
  private async event(
    tx: Prisma.TransactionClient,
    u: AuthUser,
    id: string,
    action: string,
    note: string,
    before: unknown,
    after: unknown,
  ) {
    await tx.qualityEvent.create({
      data: {
        tenantId: u.tenantId,
        actorId: u.id,
        inspectionId: id,
        action,
        note,
        snapshot: json({ before, after }),
      },
    });
  }
  private log(u: AuthUser, id: string, action: AuditAction, before: unknown, after: unknown) {
    return this.audit.log({
      tenantId: u.tenantId,
      userId: u.id,
      entityType: 'quality-inspection',
      entityId: id,
      action,
      before: json(before),
      after: json(after),
    });
  }
  async plans(tenantId: string, q: QualityQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.QualityPlanWhereInput = {
        tenantId,
        ...(q.active ? { active: q.active === 'true' } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: 'insensitive' } },
                { name: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.qualityPlan.findMany({
        where,
        select: planSelect,
        skip,
        take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.db.qualityPlan.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async plan(tenantId: string, id: string) {
    const r = await this.db.qualityPlan.findFirst({ where: { tenantId, id }, select: planSelect });
    if (!r) throw new NotFoundException('Plan introuvable.');
    return r;
  }
  async createPlan(u: AuthUser, dto: CreatePlanDto) {
    const criteria = checked(() => validateQualityCriteria(dto.criteria));
    return this.locked(u.tenantId, async (tx) => {
      if (await tx.qualityPlan.findFirst({ where: { tenantId: u.tenantId, code: dto.code } }))
        throw new ConflictException('Ce code existe déjà. Vérifiez le plan existant.');
      return tx.qualityPlan.create({
        data: { ...dto, criteria: json(criteria), tenantId: u.tenantId },
        select: planSelect,
      });
    });
  }
  async updatePlan(u: AuthUser, id: string, dto: UpdatePlanDto) {
    const criteria = checked(() => validateQualityCriteria(dto.criteria));
    return this.locked(u.tenantId, async (tx) => {
      const old = await tx.qualityPlan.findFirst({ where: { tenantId: u.tenantId, id } });
      if (!old) throw new NotFoundException('Plan introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      return tx.qualityPlan.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: {
          name: dto.name,
          instructions: dto.instructions,
          criteria: json(criteria),
          active: dto.active,
          revision: old.revision + 1,
          updatedAt,
        },
        select: planSelect,
      });
    });
  }
  private async sourceAccess(u: AuthUser, kind: string, required = true) {
    if (kind === 'MANUAL') return true;
    const rule = sourceRules[kind];
    const allowed =
      !!rule &&
      u.permissions.includes(rule.permission) &&
      (await this.modules.getEnabledKeys(u.tenantId)).has(rule.module);
    if (!allowed && required)
      throw new ForbiddenException(
        'Le module source doit être activé et son droit de lecture accordé.',
      );
    return allowed;
  }
  async references(u: AuthUser, q: QualityQueryDto) {
    if (!q.kind || q.kind === 'MANUAL')
      throw new BadRequestException('Choisissez le type de dossier source.');
    await this.sourceAccess(u, q.kind);
    const { page, pageSize, skip, take } = paginationArgs(q),
      tenantId = u.tenantId,
      search = q.search;
    if (q.kind === 'LOT') {
      const where: Prisma.WmsLotWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { item: { tenantId, sku: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await this.db.$transaction([
        this.db.wmsLot.findMany({
          where,
          skip,
          take,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            code: true,
            disposition: true,
            item: { select: { sku: true, name: true } },
          },
        }),
        this.db.wmsLot.count({ where }),
      ]);
      return paginated(
        rows.map((r) => ({
          id: r.id,
          name: `${r.item.sku} · ${r.code}`,
          disposition: r.disposition,
        })),
        total,
        page,
        pageSize,
      );
    }
    if (q.kind === 'RECEIPT') {
      const where: Prisma.ReceiptWhereInput = {
        tenantId,
        status: 'POSTED',
        ...(search ? { number: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await this.db.$transaction([
        this.db.receipt.findMany({
          where,
          skip,
          take,
          orderBy: { id: 'asc' },
          select: { id: true, number: true },
        }),
        this.db.receipt.count({ where }),
      ]);
      return paginated(
        rows.map((r) => ({ id: r.id, name: r.number })),
        total,
        page,
        pageSize,
      );
    }
    if (q.kind === 'MANUFACTURING') {
      const where: Prisma.ManufacturingOrderWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await this.db.$transaction([
        this.db.manufacturingOrder.findMany({
          where,
          skip,
          take,
          orderBy: { id: 'asc' },
          select: { id: true, number: true, name: true },
        }),
        this.db.manufacturingOrder.count({ where }),
      ]);
      return paginated(
        rows.map((r) => ({ id: r.id, name: `${r.number} · ${r.name}` })),
        total,
        page,
        pageSize,
      );
    }
    const where: Prisma.SupportCaseWhereInput = {
      tenantId,
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { title: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.supportCase.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'asc' },
        select: { id: true, number: true, title: true },
      }),
      this.db.supportCase.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ id: r.id, name: `${r.number} · ${r.title}` })),
      total,
      page,
      pageSize,
    );
  }
  async summary(tenantId: string) {
    const [draft, inProgress, failed, openNonconformities] = await this.db.$transaction([
      this.db.qualityInspection.count({ where: { tenantId, status: 'DRAFT' } }),
      this.db.qualityInspection.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
      this.db.qualityInspection.count({
        where: { tenantId, status: 'COMPLETED', outcome: 'FAIL' },
      }),
      this.db.qualityNonconformity.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
    ]);
    return { draft, inProgress, failed, openNonconformities };
  }
  async inspections(tenantId: string, q: QualityQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.QualityInspectionWhereInput = {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { number: { contains: q.search, mode: 'insensitive' } },
                { title: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.qualityInspection.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          title: true,
          planName: true,
          planRevision: true,
          status: true,
          outcome: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.db.qualityInspection.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  private async row(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const r = await tx.qualityInspection.findFirst({ where: { tenantId, id } });
    if (!r) throw new NotFoundException('Contrôle introuvable.');
    return r;
  }
  async inspection(u: AuthUser, id: string) {
    const r = await this.row(this.db, u.tenantId, id),
      kind = sourceKind(r);
    let source: { kind: string; available: boolean; id?: string; label?: string; href?: string } = {
      kind,
      available: await this.sourceAccess(u, kind, false),
    };
    if (source.available) {
      if (r.lotId) {
        const s = await this.db.wmsLot.findFirst({
          where: { tenantId: u.tenantId, itemId: r.lotItemId!, id: r.lotId },
          select: { id: true, code: true, itemId: true },
        });
        if (s)
          source = {
            ...source,
            id: s.id,
            label: s.code,
            href: `/wms/items/${s.itemId}/lots?lotId=${s.id}`,
          };
      }
      if (r.receiptId) {
        const s = await this.db.receipt.findFirst({
          where: { tenantId: u.tenantId, id: r.receiptId },
          select: { id: true, number: true },
        });
        if (s) source = { ...source, id: s.id, label: s.number, href: `/wms/receiving/${s.id}` };
      }
      if (r.manufacturingOrderId) {
        const s = await this.db.manufacturingOrder.findFirst({
          where: { tenantId: u.tenantId, id: r.manufacturingOrderId },
          select: { id: true, number: true, name: true },
        });
        if (s)
          source = {
            ...source,
            id: s.id,
            label: `${s.number} · ${s.name}`,
            href: `/manufacturing/orders/${s.id}`,
          };
      }
      if (r.supportCaseId) {
        const s = await this.db.supportCase.findFirst({
          where: { tenantId: u.tenantId, id: r.supportCaseId },
          select: { id: true, number: true, title: true },
        });
        if (s)
          source = {
            ...source,
            id: s.id,
            label: `${s.number} · ${s.title}`,
            href: `/support?caseId=${s.id}`,
          };
      }
    }
    const nonconformity = await this.db.qualityNonconformity.findFirst({
      where: { tenantId: u.tenantId, inspectionId: id },
      select: { id: true, number: true, status: true },
    });
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      planName: r.planName,
      planRevision: r.planRevision,
      instructions: r.instructions,
      criteria: r.criteria,
      results: r.results,
      status: r.status,
      outcome: r.outcome,
      updatedAt: r.updatedAt,
      completedAt: r.completedAt,
      source,
      ...(r.lotId && source.available
        ? {
            lotContext: {
              snapshot: r.lotSnapshot,
              ...(await this.lotFreshness(this.db, u.tenantId, r)),
            },
          }
        : {}),
      nonconformity,
      evaluation: evaluateQualityResults(r.criteria as unknown as QualityCriterion[], r.results),
    };
  }
  async createInspection(u: AuthUser, dto: CreateInspectionDto) {
    if ((dto.sourceKind === 'MANUAL') === !!dto.sourceId)
      throw new BadRequestException(
        'Un contrôle manuel n’a pas de source; les autres exigent un dossier source.',
      );
    await this.sourceAccess(u, dto.sourceKind);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([u.id, dto.planId, dto.title, dto.sourceKind, dto.sourceId ?? null]))
      .digest('hex');
    const result = await this.locked(u.tenantId, async (tx) => {
      if (dto.sourceKind === 'LOT')
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${u.tenantId} FOR UPDATE`;
      const previous = await tx.qualityInspection.findFirst({
        where: { tenantId: u.tenantId, operationKey: dto.operationKey },
      });
      if (previous) {
        if (previous.requestFingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne un autre contrôle.');
        return { id: previous.id, replayed: true };
      }
      await this.ownership.assertOwned('qualityPlan', dto.planId, u.tenantId, tx);
      const plan = await tx.qualityPlan.findFirst({
        where: { tenantId: u.tenantId, id: dto.planId, active: true },
      });
      if (!plan) throw new ConflictException('Choisissez un plan actif.');
      const links: { receiptId?: string; manufacturingOrderId?: string; supportCaseId?: string } =
        {};
      let lotContext:
        | {
            lotId: string;
            lotItemId: string;
            lotSnapshot: Prisma.InputJsonValue;
            lotDispositionRevision: number;
            lotMovementCount: number;
          }
        | undefined;
      if (dto.sourceKind === 'LOT') {
        await this.ownership.assertOwned('wmsLot', dto.sourceId!, u.tenantId, tx);
        const lot = await tx.wmsLot.findFirst({
          where: { tenantId: u.tenantId, id: dto.sourceId },
          include: { item: true },
        });
        if (!lot) throw new NotFoundException('Lot introuvable dans cette entreprise.');
        lotContext = {
          lotId: lot.id,
          lotItemId: lot.itemId,
          lotDispositionRevision: lot.dispositionRevision,
          lotMovementCount: await tx.stockMovement.count({
            where: { tenantId: u.tenantId, itemId: lot.itemId, lotId: lot.id },
          }),
          lotSnapshot: json({
            code: lot.code,
            supplierLot: lot.supplierLot,
            itemId: lot.itemId,
            sku: lot.item.sku,
            name: lot.item.name,
            unit: lot.item.unit,
            manufacturedOn: lot.manufacturedOn,
            expiresOn: lot.expiresOn,
            disposition: lot.disposition,
            dispositionRevision: lot.dispositionRevision,
          }),
        };
      }
      if (dto.sourceKind === 'RECEIPT') {
        await this.ownership.assertOwned('receipt', dto.sourceId!, u.tenantId, tx);
        if (
          !(await tx.receipt.findFirst({
            where: { tenantId: u.tenantId, id: dto.sourceId, status: 'POSTED' },
          }))
        )
          throw new ConflictException('La réception doit être validée.');
        links.receiptId = dto.sourceId;
      }
      if (dto.sourceKind === 'MANUFACTURING') {
        await this.ownership.assertOwned('manufacturingOrder', dto.sourceId!, u.tenantId, tx);
        links.manufacturingOrderId = dto.sourceId;
      }
      if (dto.sourceKind === 'SUPPORT') {
        await this.ownership.assertOwned('supportCase', dto.sourceId!, u.tenantId, tx);
        links.supportCaseId = dto.sourceId;
      }
      const r = await tx.qualityInspection.create({
        data: {
          tenantId: u.tenantId,
          title: dto.title,
          planId: plan.id,
          planName: plan.name,
          planRevision: plan.revision,
          instructions: plan.instructions,
          criteria: plan.criteria!,
          ...links,
          ...lotContext,
          operationKey: dto.operationKey,
          requestFingerprint: fingerprint,
          number: await this.sequences.nextNumber(u.tenantId, 'quality-inspection'),
        },
      });
      await this.event(tx, u, r.id, 'CREATE', 'Contrôle préparé', null, {
        ...snapshot(r),
        planName: r.planName,
        planRevision: r.planRevision,
      });
      return { id: r.id, replayed: false };
    });
    if (!result.replayed)
      await this.log(u, result.id, AuditAction.CREATE, null, { title: dto.title });
    return { ...(await this.inspection(u, result.id)), replayed: result.replayed };
  }
  async results(u: AuthUser, id: string, dto: ResultsDto) {
    const change = await this.locked(u.tenantId, async (tx) => {
      const old = await this.row(tx, u.tenantId, id),
        updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (old.status !== 'IN_PROGRESS')
        throw new ConflictException('Seul un contrôle en cours peut recevoir des résultats.');
      const evaluation = checked(() =>
        evaluateQualityResults(old.criteria as unknown as QualityCriterion[], dto.results),
      );
      const row = await tx.qualityInspection.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: { results: json(evaluation.results), updatedAt },
      });
      await this.event(tx, u, id, 'RESULTS', 'Résultats enregistrés', snapshot(old), snapshot(row));
      return { before: snapshot(old), after: snapshot(row) };
    });
    await this.log(u, id, AuditAction.UPDATE, change.before, change.after);
    return this.inspection(u, id);
  }
  async transition(u: AuthUser, id: string, dto: InspectionTransitionDto) {
    const inspection = await this.row(this.db, u.tenantId, id);
    if (inspection.lotId && dto.status === 'COMPLETED') await this.sourceAccess(u, 'LOT');
    const change = await this.locked(u.tenantId, async (tx) => {
      if (inspection.lotId)
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${u.tenantId} FOR UPDATE`;
      const old = await this.row(tx, u.tenantId, id),
        updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (
        old.lotId &&
        dto.status === 'COMPLETED' &&
        !(await this.lotFreshness(tx, u.tenantId, old)).fresh
      )
        throw new ConflictException(
          'Le lot ou ses mouvements ont changé depuis la préparation du contrôle. Annulez ce contrôle et préparez-en un nouveau.',
        );
      if (!canTransitionQualityInspection(old.status as QualityInspectionStatus, dto.status))
        throw new ConflictException('Transition de contrôle interdite.');
      const outcome =
        dto.status === 'COMPLETED'
          ? checked(() =>
              evaluateQualityResults(
                old.criteria as unknown as QualityCriterion[],
                old.results,
                true,
              ),
            ).outcome
          : null;
      const claim = await tx.qualityInspection.updateMany({
        where: { tenantId: u.tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: {
          status: dto.status,
          updatedAt,
          outcome,
          completedAt: dto.status === 'COMPLETED' ? updatedAt : null,
        },
      });
      if (claim.count !== 1) throw new ConflictException('Ce contrôle a changé.');
      if (outcome === 'FAIL') {
        const nc = await tx.qualityNonconformity.create({
          data: {
            tenantId: u.tenantId,
            inspectionId: id,
            title: old.title,
            number: await this.sequences.nextNumber(u.tenantId, 'quality-nonconformity'),
          },
        });
        await this.event(tx, u, id, 'NC_OPEN', 'Échec du contrôle : non-conformité créée.', null, {
          id: nc.id,
          number: nc.number,
          status: nc.status,
        });
      }
      const after = { ...snapshot(old), status: dto.status, outcome };
      await this.event(tx, u, id, 'TRANSITION', dto.note, snapshot(old), after);
      return { before: snapshot(old), after };
    });
    await this.log(u, id, AuditAction.UPDATE, change.before, change.after);
    return this.inspection(u, id);
  }
  async nonconformities(tenantId: string, q: QualityQueryDto, userId?: string) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.QualityNonconformityWhereInput = {
        tenantId,
        ...(q.assignment === 'mine'
          ? { assigneeUserId: userId ?? '__none__' }
          : q.assignment === 'unassigned'
            ? { assigneeUserId: null }
            : {}),
        ...(q.overdue
          ? {
              dueDate: { lt: calendarDate(new Date().toISOString().slice(0, 10)) },
              NOT: { status: 'CLOSED' },
            }
          : {}),
        ...(q.ncStatus ? { status: q.ncStatus } : {}),
        ...(q.search
          ? {
              OR: [
                { number: { contains: q.search, mode: 'insensitive' } },
                { title: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.qualityNonconformity.findMany({
        where,
        select: ncSelect,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.qualityNonconformity.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async nonconformity(tenantId: string, id: string) {
    const r = await this.db.qualityNonconformity.findFirst({
      where: { tenantId, id },
      select: ncSelect,
    });
    if (!r) throw new NotFoundException('Non-conformité introuvable.');
    return r;
  }
  async updateNonconformity(
    u: AuthUser,
    id: string,
    dto: NonconformityUpdateDto | NonconformityTransitionDto,
  ) {
    const change = await this.locked(u.tenantId, async (tx) => {
      const old = await tx.qualityNonconformity.findFirst({
        where: { tenantId: u.tenantId, id },
        select: ncSelect,
      });
      if (!old) throw new NotFoundException('Non-conformité introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      let data: Prisma.QualityNonconformityUpdateManyMutationInput;
      if ('status' in dto) {
        if (
          !canTransitionQualityNonconformity(old.status as QualityNonconformityStatus, dto.status)
        )
          throw new ConflictException('Transition de non-conformité interdite.');
        if (dto.status === 'RESOLVED' && (!old.rootCause || !old.correctiveAction))
          throw new ConflictException(
            'Enregistrez une cause et une action corrective avant de déclarer l’action réalisée.',
          );
        data = { status: dto.status, updatedAt };
      } else {
        if (!['OPEN', 'IN_PROGRESS'].includes(old.status))
          throw new ConflictException(
            'Rouvrez le traitement avant de modifier l’analyse. Une clôture est définitive.',
          );
        data = { rootCause: dto.rootCause, correctiveAction: dto.correctiveAction, updatedAt };
      }
      const claim = await tx.qualityNonconformity.updateMany({
        where: { tenantId: u.tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data,
      });
      if (claim.count !== 1) throw new ConflictException('Cette non-conformité a changé.');
      const after = await tx.qualityNonconformity.findFirstOrThrow({
        where: { tenantId: u.tenantId, id },
        select: ncSelect,
      });
      await this.event(
        tx,
        u,
        old.inspectionId,
        'NC_UPDATE',
        'note' in dto ? dto.note : 'Analyse et action corrective enregistrées',
        old,
        after,
      );
      return { before: old, after };
    });
    await this.log(u, change.after.inspectionId, AuditAction.UPDATE, change.before, change.after);
    return change.after;
  }
  async history(u: AuthUser, id: string, q: QualityQueryDto) {
    await this.row(this.db, u.tenantId, id);
    const { page, pageSize, skip, take } = paginationArgs(q),
      where = { tenantId: u.tenantId, inspectionId: id };
    const [items, total] = await this.db.$transaction([
      this.db.qualityEvent.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          note: true,
          snapshot: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
      this.db.qualityEvent.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  private async lotFreshness(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: QualityInspection,
  ) {
    const lot = await tx.wmsLot.findFirst({
      where: { tenantId, itemId: row.lotItemId!, id: row.lotId! },
    });
    const movementCount = await tx.stockMovement.count({
      where: { tenantId, itemId: row.lotItemId!, lotId: row.lotId! },
    });
    return {
      fresh:
        !!lot &&
        row.lotDispositionRevision === lot.dispositionRevision &&
        row.lotMovementCount === movementCount,
      disposition: lot?.disposition ?? null,
      dispositionRevision: lot?.dispositionRevision ?? null,
      movementCount,
    };
  }
}
