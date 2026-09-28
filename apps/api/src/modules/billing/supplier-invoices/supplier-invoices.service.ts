import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  calendarDate,
  canTransitionSupplierInvoice,
  supplierInvoiceNumberKey,
  validateSupplierInvoice,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
} from '../../business/business-lock';
import { SupplierInvoiceDto, SupplierInvoiceCloseDto } from './supplier-invoices.dto';

const listSelect = {
  id: true,
  number: true,
  supplierSnapshot: true,
  externalNumber: true,
  invoiceDate: true,
  dueDate: true,
  currency: true,
  status: true,
  totalAmount: true,
  updatedAt: true,
} as const;
const fingerprint = (u: AuthUser, id: string | null, kind: string, d: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(['supplier-invoice-v1', u.id, id, kind, d]))
    .digest('hex');
@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}
  private async canPurchase(u: AuthUser, tx: Prisma.TransactionClient = this.db) {
    return (
      u.permissions.includes('purchasing.read') &&
      !!(await tx.tenantModule.findFirst({
        where: { tenantId: u.tenantId, enabled: true, module: { key: 'purchasing' } },
        select: { moduleId: true },
      }))
    );
  }
  private async requirePurchase(u: AuthUser, tx: Prisma.TransactionClient = this.db) {
    if (!(await this.canPurchase(u, tx)))
      throw new ForbiddenException(
        'La lecture Achats et son activation sont nécessaires pour ce lien commercial. La saisie sans lien reste autonome.',
      );
  }
  private async parent(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.supplierInvoice.findFirst({
      where: { tenantId, id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Facture fournisseur introuvable.');
    return row;
  }
  async list(u: AuthUser, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.SupplierInvoiceWhereInput = {
      tenantId: u.tenantId,
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' } },
              { externalNumber: { contains: q.search, mode: 'insensitive' } },
              { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.supplierInvoice.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.supplierInvoice.count({ where }),
    ]);
    return paginated(rows, total, page, pageSize);
  }
  async get(u: AuthUser, id: string) {
    const r = await this.parent(this.db, u.tenantId, id);
    const purchaseVisible = await this.canPurchase(u);
    const operations = await this.db.supplierInvoiceOperation.findMany({
      where: { tenantId: u.tenantId, invoiceId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        kind: true,
        createdAt: true,
        actor: { select: { firstName: true, lastName: true } },
      },
    });
    return {
      id: r.id,
      number: r.number,
      supplierId: r.supplierId,
      supplierSnapshot: r.supplierSnapshot,
      externalNumber: r.externalNumber,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      currency: r.currency,
      status: r.status,
      notes: r.notes,
      netAmount: r.netAmount,
      taxAmount: r.taxAmount,
      totalAmount: r.totalAmount,
      taxes: r.taxes,
      updatedAt: r.updatedAt,
      originalEvidenceId: r.originalEvidenceId,
      qualificationNote: r.qualificationNote,
      closedAt: r.closedAt,
      purchaseVisible,
      lines: r.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        netAmount: l.netAmount,
        hasPurchaseLink: !!l.purchaseLineId,
        ...(purchaseVisible
          ? { purchaseLineId: l.purchaseLineId, purchaseSnapshot: l.purchaseSnapshot }
          : {}),
      })),
      operations,
    };
  }
  async sources(u: AuthUser, supplierId: string, q: ListQueryDto) {
    await this.requirePurchase(u);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.SupplierOrderLineWhereInput = {
      tenantId: u.tenantId,
      order: { tenantId: u.tenantId, supplierId, status: { in: ['CONFIRMED', 'CLOSED'] } },
      ...(q.search
        ? {
            OR: [
              { nameSnapshot: { contains: q.search, mode: 'insensitive' } },
              { order: { number: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.supplierOrderLine.findMany({
        where,
        orderBy: [{ orderId: 'asc' }, { position: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          nameSnapshot: true,
          unitSnapshot: true,
          quantity: true,
          unitPrice: true,
          order: { select: { number: true, currency: true, status: true } },
        },
      }),
      this.db.supplierOrderLine.count({ where }),
    ]);
    return paginated(
      items.map((l) => ({
        ...l,
        sourceLabel: `${l.order.number} · ${l.quantity.toFixed()} ${l.unitSnapshot} · ${l.order.currency}`,
      })),
      total,
      page,
      pageSize,
    );
  }
  private async source(
    u: AuthUser,
    tx: Prisma.TransactionClient,
    lineId: string,
    supplierId: string,
    currency: string,
    unit: string,
  ) {
    await this.requirePurchase(u, tx);
    await this.ownership.assertOwned('supplierOrderLine', lineId, u.tenantId, tx);
    const line = await tx.supplierOrderLine.findFirst({
      where: { tenantId: u.tenantId, id: lineId },
      include: { order: true },
    });
    if (
      !line ||
      !['CONFIRMED', 'CLOSED'].includes(line.order.status) ||
      line.order.supplierId !== supplierId ||
      line.order.currency !== currency ||
      line.unitSnapshot !== unit
    )
      throw new ConflictException(
        'La ligne liée doit appartenir à une commande confirmée/clôturée du même fournisseur, dans la même devise et unité.',
      );
    return {
      orderId: line.order.id,
      orderNumber: line.order.number,
      orderStatus: line.order.status,
      lineId: line.id,
      description: line.nameSnapshot,
      quantity: line.quantity.toFixed(),
      unit: line.unitSnapshot,
      unitPrice: line.unitPrice.toFixed(),
      currency: line.order.currency,
    };
  }
  async request(u: AuthUser, key: string) {
    const op = await this.db.supplierInvoiceOperation.findFirst({
      where: { tenantId: u.tenantId, operationKey: key, actorId: u.id },
    });
    if (!op) throw new NotFoundException('Aucun enregistrement confirmé pour cette demande.');
    const right =
      op.kind === 'QUALIFIED'
        ? 'billing.supplier-invoices.qualify'
        : 'billing.supplier-invoices.manage';
    if (!u.permissions.includes(right)) throw new ForbiddenException('Droit de reprise manquant.');
    const row = await this.parent(this.db, u.tenantId, op.invoiceId);
    if (row.lines.some((l) => l.purchaseLineId)) await this.requirePurchase(u);
    return { id: op.invoiceId, replayed: true };
  }
  async save(u: AuthUser, id: string | null, d: SupplierInvoiceDto) {
    const hash = fingerprint(u, id, 'SAVE', d);
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const prior = await tx.supplierInvoiceOperation.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== hash)
          throw new ConflictException('Clé déjà utilisée pour une autre demande.');
        const r = await this.parent(tx, u.tenantId, prior.invoiceId);
        if (r.lines.some((l) => l.purchaseLineId)) await this.requirePurchase(u, tx);
        return { id: prior.invoiceId, replayed: true };
      }
      const current = id ? await this.parent(tx, u.tenantId, id) : null;
      if (current?.lines.some((l) => l.purchaseLineId)) await this.requirePurchase(u, tx);
      if (current && current.status !== 'DRAFT')
        throw new ConflictException('Une facture close est figée.');
      if (current && !d.expectedUpdatedAt)
        throw new BadRequestException('Version attendue obligatoire.');
      if (!current && d.expectedUpdatedAt)
        throw new BadRequestException('Une création ne reçoit pas de version.');
      const updatedAt = current ? nextBusinessVersion(current, d.expectedUpdatedAt!) : new Date();
      let totals;
      try {
        totals = validateSupplierInvoice(d);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      await this.ownership.assertOwned('businessPartner', d.supplierId, u.tenantId, tx);
      const supplier = await tx.businessPartner.findFirst({
        where: { tenantId: u.tenantId, id: d.supplierId, isSupplier: true, active: true },
        select: { id: true, code: true, name: true },
      });
      if (!supplier) throw new BadRequestException('Fournisseur actif requis.');
      const numberKey = supplierInvoiceNumberKey(d.externalNumber);
      if (
        await tx.supplierInvoice.count({
          where: {
            tenantId: u.tenantId,
            supplierId: d.supplierId,
            externalNumberKey: numberKey,
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new ConflictException(
          'Ce numéro de facture existe déjà pour ce fournisseur, même dans les dossiers annulés.',
        );
      const lines = [];
      for (const [position, l] of d.lines.entries())
        lines.push({
          tenantId: u.tenantId,
          position,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          netAmount: l.netAmount,
          purchaseLineId: l.purchaseLineId,
          purchaseSnapshot: l.purchaseLineId
            ? await this.source(u, tx, l.purchaseLineId, d.supplierId, d.currency, l.unit)
            : Prisma.JsonNull,
        });
      const data = {
        supplierId: d.supplierId,
        supplierSnapshot: supplier,
        externalNumber: d.externalNumber,
        externalNumberKey: numberKey,
        invoiceDate: calendarDate(d.invoiceDate),
        dueDate: d.dueDate ? calendarDate(d.dueDate) : null,
        currency: d.currency,
        notes: d.notes,
        taxes: d.taxes.map((t) => ({ label: t.label, amount: t.amount })),
        ...totals,
        updatedAt,
      };
      let invoiceId: string;
      if (current) {
        await tx.supplierInvoiceLine.deleteMany({
          where: { tenantId: u.tenantId, invoiceId: current.id },
        });
        await tx.supplierInvoice.update({
          where: { tenantId_id: { tenantId: u.tenantId, id: current.id } },
          data,
        });
        invoiceId = current.id;
      } else {
        const number = await this.sequences.nextNumber(u.tenantId, 'supplier-invoice', tx);
        invoiceId = (
          await tx.supplierInvoice.create({ data: { ...data, tenantId: u.tenantId, number } })
        ).id;
      }
      await tx.supplierInvoiceLine.createMany({ data: lines.map((l) => ({ ...l, invoiceId })) });
      await tx.supplierInvoiceOperation.create({
        data: {
          tenantId: u.tenantId,
          invoiceId,
          actorId: u.id,
          operationKey: d.operationKey,
          fingerprint: hash,
          kind: current ? 'UPDATED' : 'CREATED',
        },
      });
      return { id: invoiceId, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-invoice',
        entityId: result.id,
        action: id ? AuditAction.UPDATE : AuditAction.CREATE,
        after: { status: 'DRAFT' },
      });
    return result;
  }
  async close(u: AuthUser, id: string, to: 'QUALIFIED' | 'CANCELLED', d: SupplierInvoiceCloseDto) {
    const hash = fingerprint(u, id, to, d);
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const r = await this.parent(tx, u.tenantId, id);
      if (r.lines.some((l) => l.purchaseLineId)) await this.requirePurchase(u, tx);
      const prior = await tx.supplierInvoiceOperation.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== hash)
          throw new ConflictException('Clé déjà utilisée pour une autre demande.');
        return { id, replayed: true };
      }
      if (!canTransitionSupplierInvoice(r.status, to))
        throw new ConflictException('Seul un brouillon peut être qualifié ou annulé.');
      const updatedAt = nextBusinessVersion(r, d.expectedUpdatedAt);
      if (d.note.trim().length < 10)
        throw new BadRequestException('Expliquez la vérification ou l’annulation.');
      if (to === 'QUALIFIED') {
        if (!d.evidenceId) throw new BadRequestException('Sélectionnez le document original reçu.');
        await this.ownership.assertOwned('supplierInvoiceEvidence', d.evidenceId, u.tenantId, tx);
        if (
          !(await tx.supplierInvoiceEvidence.findFirst({
            where: { tenantId: u.tenantId, invoiceId: id, id: d.evidenceId },
          }))
        )
          throw new BadRequestException('La pièce doit appartenir à cette facture.');
        if (
          !(await tx.businessPartner.findFirst({
            where: { tenantId: u.tenantId, id: r.supplierId, active: true, isSupplier: true },
          }))
        )
          throw new ConflictException('Le fournisseur n’est plus actif.');
        // A qualified document freezes the exact reviewed source, never an automatic matching result.
        for (const l of r.lines)
          if (l.purchaseLineId) {
            const now = await this.source(
              u,
              tx,
              l.purchaseLineId,
              r.supplierId,
              r.currency,
              l.unit,
            );
            const before = l.purchaseSnapshot as Record<string, unknown>;
            // JSONB key order is not significant. Closing an order does not change its commercial lines.
            if (
              Object.entries(now).some(
                ([key, value]) => key !== 'orderStatus' && before[key] !== value,
              )
            )
              throw new ConflictException(
                'La source commerciale a changé. Revoyez et enregistrez le brouillon.',
              );
          }
      } else if (d.evidenceId)
        throw new BadRequestException('L’annulation ne sélectionne pas de facture originale.');
      await tx.supplierInvoice.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: {
          status: to,
          updatedAt,
          closedAt: new Date(),
          qualificationNote: d.note,
          originalEvidenceId: to === 'QUALIFIED' ? d.evidenceId : null,
        },
      });
      await tx.supplierInvoiceOperation.create({
        data: {
          tenantId: u.tenantId,
          invoiceId: id,
          actorId: u.id,
          operationKey: d.operationKey,
          fingerprint: hash,
          kind: to,
        },
      });
      return { id, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-invoice',
        entityId: id,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: to, evidenceId: d.evidenceId ?? null, note: d.note },
      });
    return result;
  }
}
