import { Injectable, NotFoundException } from '@nestjs/common';
import {
  buildFlowChains,
  buildFlowMap,
  buildEntityTrace,
  moduleOfEventType,
  type FlowEvent,
  type FlowTask,
  type FlowAction,
  type FlowMap,
  type EntityTrace,
  type FlowChain,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

interface TimelineOpts {
  days: number;
  modules?: string[];
  types?: string[];
  crossOnly?: boolean;
  limit: number;
}

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  private since(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }

  async timeline(tenantId: string, opts: TimelineOpts): Promise<{ chains: FlowChain[] }> {
    const since = this.since(opts.days);

    const [rawEvents, rawTasks, rawActions] = await Promise.all([
      this.prisma.domainEvent.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
          ...(opts.types?.length ? { type: { in: opts.types } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        select: {
          id: true,
          type: true,
          subjectType: true,
          subjectId: true,
          createdAt: true,
        },
      }),
      this.prisma.operationalTask.findMany({
        where: { tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        select: {
          id: true,
          category: true,
          status: true,
          severity: true,
          subjectType: true,
          subjectId: true,
          sourceEventId: true,
          assigneeAgentId: true,
          createdAt: true,
        },
      }),
      this.prisma.proposedAction.findMany({
        where: { tenantId, proposedAt: { gte: since } },
        orderBy: { proposedAt: 'desc' },
        take: opts.limit,
        select: {
          id: true,
          tool: true,
          status: true,
          agentId: true,
          triggeredByRef: true,
          autoApproved: true,
          proposedAt: true,
        },
      }),
    ]);

    const fEvents: FlowEvent[] = rawEvents.map((e) => ({
      id: e.id,
      type: e.type,
      module: moduleOfEventType(e.type),
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      at: e.createdAt.toISOString(),
    }));

    const fTasks: FlowTask[] = rawTasks.map((t) => ({
      id: t.id,
      category: t.category,
      status: t.status,
      severity: String(t.severity),
      subjectType: t.subjectType,
      subjectId: t.subjectId,
      sourceEventId: t.sourceEventId,
      assigneeAgentId: t.assigneeAgentId,
      at: t.createdAt.toISOString(),
    }));

    const fActions: FlowAction[] = rawActions.map((a) => ({
      id: a.id,
      tool: a.tool,
      status: a.status,
      agentId: a.agentId,
      triggeredByRef: a.triggeredByRef,
      autoApproved: a.autoApproved,
      at: a.proposedAt.toISOString(),
    }));

    let chains = buildFlowChains(fEvents, fTasks, fActions);

    if (opts.crossOnly) {
      chains = chains.filter((c) => c.crossModule);
    }
    if (opts.modules?.length) {
      chains = chains.filter((c) => c.modules.some((m) => opts.modules!.includes(m)));
    }

    return { chains: chains.slice(0, opts.limit) };
  }

  async map(tenantId: string, days: number): Promise<FlowMap> {
    // Use a higher internal limit for map aggregation — still bounded
    const { chains } = await this.timeline(tenantId, { days, limit: 2000 });
    return buildFlowMap(chains);
  }

  async trace(
    tenantId: string,
    entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD',
    entityId: string,
  ): Promise<EntityTrace> {
    // Resolve to a TransportOrder id regardless of the entity type given.
    let orderId = entityId;

    if (entityType === 'SHIPMENT') {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: entityId, tenantId },
        select: { transportOrderId: true },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      orderId = shipment.transportOrderId;
    } else if (entityType === 'LOAD') {
      const shipment = await this.prisma.shipment.findFirst({
        where: { loadId: entityId, tenantId },
        select: { transportOrderId: true },
      });
      if (!shipment) throw new NotFoundException('Load not found or has no shipments');
      orderId = shipment.transportOrderId;
    }

    // Fetch the TransportOrder with its shipments, loads (via loadId), and pick orders.
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        createdAt: true,
        shipments: {
          select: {
            id: true,
            loadId: true,
            status: true,
            actualDeliveryAt: true,
            load: {
              select: {
                id: true,
                dispatchedAt: true,
                completedAt: true,
                trailerId: true,
              },
            },
            pickOrders: {
              select: { id: true, status: true, completedAt: true },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('TransportOrder not found');

    const shipments = order.shipments;

    // Collect unique load ids and load rows
    const loadRows = shipments
      .map((s) => s.load)
      .filter((l): l is NonNullable<(typeof shipments)[number]['load']> => l !== null);
    const loadIds = [...new Set(loadRows.map((l) => l.id))];

    // Collect pick orders across all shipments
    const pickOrders = shipments.flatMap((s) => s.pickOrders);

    // Derive dispatchedAt: earliest Load.dispatchedAt across all loads
    const dispatchTimes = loadRows
      .map((l) => l.dispatchedAt)
      .filter((d): d is Date => d !== null);
    const dispatchedAt =
      dispatchTimes.length > 0
        ? dispatchTimes.reduce((a, b) => (a < b ? a : b)).toISOString()
        : null;

    // Derive deliveredAt: use Load.completedAt if all loads completed, else latest actualDeliveryAt
    const completedTimes = loadRows
      .map((l) => l.completedAt)
      .filter((d): d is Date => d !== null);
    const allLoadsCompleted = loadRows.length > 0 && completedTimes.length === loadRows.length;

    let deliveredAt: string | null = null;
    if (allLoadsCompleted) {
      deliveredAt = completedTimes.reduce((a, b) => (a > b ? a : b)).toISOString();
    } else {
      const deliveryTimes = shipments
        .map((s) => s.actualDeliveryAt)
        .filter((d): d is Date => d !== null);
      if (deliveryTimes.length > 0 && deliveryTimes.length === shipments.length) {
        deliveredAt = deliveryTimes.reduce((a, b) => (a > b ? a : b)).toISOString();
      }
    }

    // Derive pickedAt: all pick orders must be COMPLETED
    const pickStatuses = pickOrders.map((p) => p.status);
    const allPicked =
      pickStatuses.length > 0 && pickStatuses.every((s) => s === 'COMPLETED');
    const pickedAt = allPicked
      ? (pickOrders
          .map((p) => p.completedAt)
          .filter((d): d is Date => d !== null)
          .reduce<Date | null>(
            (latest, d) => (latest === null || d > latest ? d : latest),
            null,
          )
          ?.toISOString() ?? null)
      : null;

    // v1: pickBlocked = false (no blocking signal wired)
    const pickBlocked = false;

    // v1: Yard stage — soft link (Load.trailerId ↔ YardVisit.trailerId) is too loose for v1
    // (a trailer has many visits over time; no temporal correlation possible without load dates).
    // Leave yardAt: null and yardVisits: [] — the Cour stage shows PENDING.
    const yardAt: string | null = null;
    const yardVisitIds: string[] = [];

    // Find invoices via IncomingInvoiceLine.matchedLoadId (IncomingCarrierInvoice has no direct loadId)
    let invoiceIds: string[] = [];
    if (loadIds.length > 0) {
      const invoiceLines = await this.prisma.incomingInvoiceLine.findMany({
        where: { matchedLoadId: { in: loadIds } },
        select: { invoiceId: true },
        distinct: ['invoiceId'],
      });
      const rawInvoiceIds = [...new Set(invoiceLines.map((l) => l.invoiceId))];

      // Verify the invoices belong to this tenant
      if (rawInvoiceIds.length > 0) {
        const ownedInvoices = await this.prisma.incomingCarrierInvoice.findMany({
          where: { id: { in: rawInvoiceIds }, tenantId },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });
        invoiceIds = ownedInvoices.map((i) => i.id);
        // billedAt = creation date of the first invoice
      }
    }

    // billedAt = earliest invoice creation date (or null if none)
    let billedAt: string | null = null;
    if (invoiceIds.length > 0) {
      const firstInvoice = await this.prisma.incomingCarrierInvoice.findFirst({
        where: { id: { in: invoiceIds }, tenantId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      billedAt = firstInvoice?.createdAt.toISOString() ?? null;
    }

    return buildEntityTrace({
      rootType: entityType,
      rootId: order.id,
      createdAt: order.createdAt.toISOString(),
      pickedAt,
      pickBlocked,
      dispatchedAt,
      yardAt,
      deliveredAt,
      billedAt,
      refs: {
        shipments: shipments.map((s) => s.id),
        loads: loadIds,
        pickOrders: pickOrders.map((p) => p.id),
        yardVisits: yardVisitIds,
        invoices: invoiceIds,
      },
    });
  }
}
