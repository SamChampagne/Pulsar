import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  FreightAuditStatus,
  MODULE_KEYS,
  canTransitionFreightAudit,
  evaluateReconciliation,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { CreateIncomingInvoiceDto, FreightDisputeDto, FreightResolveDto } from './dto/freight-audit.dto';

const invoiceInclude = { lines: true, carrier: { select: { id: true, code: true, name: true } } } as const;
const round = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class FreightAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  private async get(tenantId: string, id: string) {
    const invoice = await this.prisma.incomingCarrierInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
    if (!invoice) throw new NotFoundException('Incoming carrier invoice not found');
    return invoice;
  }

  list(tenantId: string, status?: FreightAuditStatus) {
    return this.prisma.incomingCarrierInvoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      include: invoiceInclude,
    });
  }

  getOne(tenantId: string, id: string) {
    return this.get(tenantId, id);
  }

  /** Intake: persist the carrier's invoice + lines, emit the domain event (best-effort). */
  async create(tenantId: string, userId: string, dto: CreateIncomingInvoiceDto) {
    const chargedTotal = round(dto.lines.reduce((a, l) => a + l.chargedAmount, 0));
    const created = await this.prisma.incomingCarrierInvoice.create({
      data: {
        tenantId,
        carrierId: dto.carrierId,
        carrierInvoiceNumber: dto.carrierInvoiceNumber,
        currency: dto.currency ?? 'CAD',
        chargedTotal,
        createdById: userId,
        lines: { create: dto.lines.map((l) => ({ lineRef: l.lineRef, description: l.description, chargedAmount: l.chargedAmount })) },
      },
      include: invoiceInclude,
    });
    await this.auditLogs.log({ tenantId, userId, action: AuditAction.CREATE, entityType: 'incoming-carrier-invoice', entityId: created.id, after: { carrierInvoiceNumber: dto.carrierInvoiceNumber, lines: dto.lines.length } });
    await this.domainEvents.emit(tenantId, 'carrier-invoice.received', { type: 'incoming-carrier-invoice', id: created.id }, { invoiceId: created.id, carrierId: dto.carrierId });
    return created;
  }

  /** Tenant billing tolerances (defaults 2 % / 25) — same source as the buy-side reconcile. */
  private async tolerances(tenantId: string) {
    const tm = await this.prisma.tenantModule.findFirst({ where: { tenantId, module: { key: MODULE_KEYS.BILLING } } });
    const s = (tm?.settings ?? {}) as { tolerancePct?: unknown; toleranceAbsolute?: unknown };
    const sane = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fb; };
    return { tolerancePct: sane(s.tolerancePct, 2), toleranceAbsolute: sane(s.toleranceAbsolute, 25) };
  }

  /** Deterministic match: each line → Load by loadNumber (tenant + carrier scoped), variance vs frozen estimatedCost. */
  async audit(tenantId: string, userId: string, id: string) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== FreightAuditStatus.RECEIVED && invoice.status !== FreightAuditStatus.FLAGGED) {
      throw new BadRequestException('Only RECEIVED or FLAGGED invoices can be (re-)audited');
    }
    let unmatched = 0;
    const lineWrites: Prisma.PrismaPromise<unknown>[] = [];
    const matched: { expected: number; invoiced: number }[] = [];
    for (const line of invoice.lines) {
      const load = await this.prisma.load.findFirst({
        where: { tenantId, carrierId: invoice.carrierId, loadNumber: line.lineRef },
        select: { id: true, estimatedCost: true },
      });
      if (!load || load.estimatedCost === null) {
        unmatched++;
        lineWrites.push(this.prisma.incomingInvoiceLine.update({ where: { id: line.id }, data: { matchedLoadId: null, expectedAmount: null, variance: null } }));
        continue;
      }
      const expected = Number(load.estimatedCost);
      const invoiced = Number(line.chargedAmount);
      matched.push({ expected, invoiced });
      lineWrites.push(this.prisma.incomingInvoiceLine.update({ where: { id: line.id }, data: { matchedLoadId: load.id, expectedAmount: expected, variance: round(invoiced - expected) } }));
    }
    const outcome = evaluateReconciliation(matched, await this.tolerances(tenantId));
    const matchedTotal = round(matched.reduce((a, m) => a + m.expected, 0));
    const next = outcome.withinTolerance && unmatched === 0 ? FreightAuditStatus.MATCHED : FreightAuditStatus.FLAGGED;
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, next)) {
      throw new BadRequestException(`Cannot move freight audit from ${invoice.status} to ${next}`);
    }
    const tx = await this.prisma.$transaction([
      ...lineWrites,
      this.prisma.incomingCarrierInvoice.updateMany({
        where: { id, tenantId, status: { in: [FreightAuditStatus.RECEIVED, FreightAuditStatus.FLAGGED] } },
        data: { status: next, matchedTotal, varianceTotal: outcome.varianceTotal, varianceGross: outcome.varianceGross, auditedAt: new Date() },
      }),
    ]);
    if ((tx[tx.length - 1] as { count: number }).count === 0) throw new BadRequestException('Invoice state changed concurrently — retry');
    await this.auditLogs.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: invoice.status }, after: { status: next, varianceGross: outcome.varianceGross, unmatched } });
    return this.get(tenantId, id);
  }

  async dispute(tenantId: string, actorId: string, id: string, dto: FreightDisputeDto, agentId?: string) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.DISPUTED)) {
      throw new BadRequestException(`Only FLAGGED invoices can be disputed`);
    }
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: FreightAuditStatus.FLAGGED },
      data: { status: FreightAuditStatus.DISPUTED, disputeReasonCode: dto.reasonCode, disputeNote: dto.note, disputedByAgentId: agentId ?? null },
    });
    if (count === 0) throw new BadRequestException('Only FLAGGED invoices can be disputed');
    await this.auditLogs.log({ tenantId, userId: actorId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: invoice.status }, after: { status: 'DISPUTED', reasonCode: dto.reasonCode } });
    return this.get(tenantId, id);
  }

  /** KEEP_EXPECTED books the recovered overcharge (variance > 0). ACCEPT_CHARGED recovers nothing. */
  async resolve(tenantId: string, userId: string, id: string, dto: FreightResolveDto) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.RESOLVED)) {
      throw new BadRequestException('Only DISPUTED invoices can be resolved');
    }
    const variance = Number(invoice.varianceTotal ?? 0);
    const recovered = dto.resolution === 'KEEP_EXPECTED' && variance > 0 ? round(variance) : 0;
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: FreightAuditStatus.DISPUTED },
      data: { status: FreightAuditStatus.RESOLVED, resolution: dto.resolution, disputeReasonCode: dto.reasonCode, disputeNote: dto.note, recoveredAmount: recovered, resolvedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException('Only DISPUTED invoices can be resolved');
    await this.auditLogs.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: 'DISPUTED' }, after: { status: 'RESOLVED', resolution: dto.resolution, recovered } });
    return this.get(tenantId, id);
  }

  async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.PAID)) {
      throw new BadRequestException('Only MATCHED or RESOLVED invoices can be paid');
    }
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: { in: [FreightAuditStatus.MATCHED, FreightAuditStatus.RESOLVED] } },
      data: { status: FreightAuditStatus.PAID, paidAt: paidAt ? new Date(paidAt) : new Date() },
    });
    if (count === 0) throw new BadRequestException('Only MATCHED or RESOLVED invoices can be paid');
    await this.auditLogs.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, after: { status: 'PAID' } });
    return this.get(tenantId, id);
  }

  /** Recovered-savings rollup (the real $ deferred from phase 15). */
  async savings(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const resolved = await this.prisma.incomingCarrierInvoice.findMany({
      where: { tenantId, status: { in: [FreightAuditStatus.RESOLVED, FreightAuditStatus.PAID] }, resolvedAt: { gte: since } },
      select: { recoveredAmount: true, disputedByAgentId: true },
    });
    const tenantTotal = round(resolved.reduce((a, r) => a + Number(r.recoveredAmount), 0));
    // byAgent is a SUBSET of tenantTotal: human-resolved disputes (null disputedByAgentId)
    // count toward tenantTotal but have no agent bucket. sum(byAgent) <= tenantTotal by design.
    const byAgentMap = new Map<string, number>();
    for (const r of resolved) {
      if (!r.disputedByAgentId) continue;
      byAgentMap.set(r.disputedByAgentId, round((byAgentMap.get(r.disputedByAgentId) ?? 0) + Number(r.recoveredAmount)));
    }
    return { tenantTotal, byAgent: [...byAgentMap].map(([agentId, recovered]) => ({ agentId, recovered })) };
  }
}
