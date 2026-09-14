import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PERMISSIONS,
  type AuthUser,
  type DossierEntity,
  type DossierRootType,
  type WorkflowDossier,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

const LIMIT = 100;
const key = (type: string, id: string) => `${type}:${id}`;
/** Relational, bounded, read-only dossier. No inference from arbitrary JSON payloads. */
@Injectable()
export class DossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  async get(user: AuthUser, type: DossierRootType, id: string): Promise<WorkflowDossier> {
    const tenantId = user.tenantId;
    const enabled = await this.modules.getEnabledKeys(tenantId);
    const can = (module: string, permission: string) =>
      enabled.has(module) && user.permissions.some((p) => p === permission);
    const crm = can('crm', PERMISSIONS.CRM.READ);
    const transport = can('transportation', PERMISSIONS.TRANSPORTATION.ORDERS_READ);
    const planning = can('transportation', PERMISSIONS.TRANSPORTATION.PLANNING_READ);
    const wms = can('wms', PERMISSIONS.WMS.READ);
    const billing = can('billing', PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ);
    if (!(type === 'SALES_ORDER' ? crm : type === 'LOAD' ? planning : transport))
      throw new ForbiddenException('Accès au module du dossier requis');

    const result: WorkflowDossier = {
      root: null as unknown as DossierEntity,
      entities: [],
      links: [],
      activity: [],
      notices: [],
      checkedAt: new Date().toISOString(),
    };
    const add = (
      entityType: string,
      entityId: string,
      label: string,
      status: string,
      module: string,
      path: string,
    ) => {
      const entity = { id: entityId, type: entityType, label, status, module, href: path };
      if (!result.entities.some((e) => e.type === entityType && e.id === entityId))
        result.entities.push(entity);
      return entity;
    };
    const link = (a: string, aId: string, b: string, bId: string, label: string) =>
      result.links.push({ from: key(a, aId), to: key(b, bId), label });
    const bounded = <T>(rows: T[]): T[] => {
      if (
        rows.length > LIMIT &&
        !result.notices.includes(
          'Dossier volumineux : certaines relations sont masquées (limite de 100 par famille).',
        )
      )
        result.notices.push(
          'Dossier volumineux : certaines relations sont masquées (limite de 100 par famille).',
        );
      return rows.slice(0, LIMIT);
    };
    let seedOrderIds: string[] = [];
    let salesIds: string[] = [];
    let loadRootId: string | undefined;
    if (type === 'SALES_ORDER') {
      const row = await this.prisma.salesOrder.findFirst({
        where: { id, tenantId },
        select: { id: true, number: true, status: true },
      });
      if (!row) throw new NotFoundException('Dossier introuvable');
      result.root = add(type, id, row.number, row.status, 'crm', `/crm/sales-orders/${id}`);
      salesIds = [id];
    } else if (type === 'TRANSPORT_ORDER') {
      const row = await this.prisma.transportOrder.findFirst({
        where: { id, tenantId },
        select: { id: true, orderNumber: true, status: true, sourceSalesOrderId: true },
      });
      if (!row) throw new NotFoundException('Dossier introuvable');
      result.root = add(
        type,
        id,
        row.orderNumber,
        row.status,
        'transportation',
        `/transport-orders/${id}`,
      );
      seedOrderIds = [id];
      if (crm && row.sourceSalesOrderId) salesIds = [row.sourceSalesOrderId];
    } else if (type === 'SHIPMENT') {
      const row = await this.prisma.shipment.findFirst({
        where: { id, tenantId },
        select: { id: true, shipmentNumber: true, status: true, transportOrderId: true },
      });
      if (!row) throw new NotFoundException('Dossier introuvable');
      result.root = add(
        type,
        id,
        row.shipmentNumber,
        row.status,
        'transportation',
        `/shipments?shipment=${id}`,
      );
      seedOrderIds = [row.transportOrderId];
    } else {
      const row = await this.prisma.load.findFirst({
        where: { id, tenantId },
        select: { id: true, loadNumber: true, status: true },
      });
      if (!row) throw new NotFoundException('Dossier introuvable');
      result.root = add(type, id, row.loadNumber, row.status, 'transportation', `/loads/${id}`);
      loadRootId = id;
      if (transport) {
        const refs = bounded(
          await this.prisma.shipment.findMany({
            where: { tenantId, loadId: id },
            select: { transportOrderId: true },
            distinct: ['transportOrderId'],
            orderBy: { transportOrderId: 'asc' },
            take: LIMIT + 1,
          }),
        );
        seedOrderIds = refs.map((r) => r.transportOrderId);
      }
    }
    if (crm && seedOrderIds.length) {
      const sources = await this.prisma.transportOrder.findMany({
        where: { tenantId, id: { in: seedOrderIds } },
        select: { sourceSalesOrderId: true },
        take: LIMIT,
      });
      salesIds = [
        ...new Set([
          ...salesIds,
          ...sources.flatMap((r) => (r.sourceSalesOrderId ? [r.sourceSalesOrderId] : [])),
        ]),
      ];
    }
    const sales =
      crm && salesIds.length
        ? bounded(
            await this.prisma.salesOrder.findMany({
              where: { tenantId, id: { in: salesIds } },
              select: { id: true, number: true, status: true },
              orderBy: { id: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    salesIds = sales.map((s) => s.id);
    for (const sale of sales)
      add('SALES_ORDER', sale.id, sale.number, sale.status, 'crm', `/crm/sales-orders/${sale.id}`);
    const orders =
      transport && (seedOrderIds.length || salesIds.length)
        ? bounded(
            await this.prisma.transportOrder.findMany({
              where: {
                tenantId,
                OR: [{ id: { in: seedOrderIds } }, { sourceSalesOrderId: { in: salesIds } }],
              },
              select: { id: true, orderNumber: true, status: true, sourceSalesOrderId: true },
              orderBy: { createdAt: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    const orderIds = orders.map((o) => o.id);
    for (const order of orders) {
      add(
        'TRANSPORT_ORDER',
        order.id,
        order.orderNumber,
        order.status,
        'transportation',
        `/transport-orders/${order.id}`,
      );
      if (order.sourceSalesOrderId && salesIds.includes(order.sourceSalesOrderId))
        link(
          'SALES_ORDER',
          order.sourceSalesOrderId,
          'TRANSPORT_ORDER',
          order.id,
          'Exécution transport',
        );
    }
    const shipments =
      transport && orderIds.length
        ? bounded(
            await this.prisma.shipment.findMany({
              where: { tenantId, transportOrderId: { in: orderIds } },
              select: {
                id: true,
                shipmentNumber: true,
                status: true,
                transportOrderId: true,
                loadId: true,
              },
              orderBy: { createdAt: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    for (const shipment of shipments) {
      add(
        'SHIPMENT',
        shipment.id,
        shipment.shipmentNumber,
        shipment.status,
        'transportation',
        `/shipments?shipment=${shipment.id}`,
      );
      link('TRANSPORT_ORDER', shipment.transportOrderId, 'SHIPMENT', shipment.id, 'Expédition');
    }
    const loadIds = [
      ...new Set([
        ...shipments.flatMap((s) => (s.loadId ? [s.loadId] : [])),
        ...(loadRootId ? [loadRootId] : []),
      ]),
    ];
    const loads =
      planning && loadIds.length
        ? bounded(
            await this.prisma.load.findMany({
              where: { tenantId, id: { in: loadIds } },
              select: { id: true, loadNumber: true, status: true },
              orderBy: { createdAt: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    for (const load of loads) {
      add('LOAD', load.id, load.loadNumber, load.status, 'transportation', `/loads/${load.id}`);
      for (const shipment of shipments.filter((s) => s.loadId === load.id))
        link('SHIPMENT', shipment.id, 'LOAD', load.id, 'Chargement');
    }
    const picks =
      wms && shipments.length
        ? bounded(
            await this.prisma.pickOrder.findMany({
              where: { tenantId, shipmentId: { in: shipments.map((s) => s.id) } },
              select: { id: true, number: true, status: true, shipmentId: true },
              orderBy: { createdAt: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    for (const pick of picks) {
      add('PICK_ORDER', pick.id, pick.number, pick.status, 'wms', `/wms/picking/${pick.id}`);
      if (pick.shipmentId)
        link('SHIPMENT', pick.shipmentId, 'PICK_ORDER', pick.id, 'Préparation entrepôt');
    }
    const saleLines =
      billing && salesIds.length
        ? bounded(
            await this.prisma.salesOrderLineItem.findMany({
              where: { tenantId, salesOrderId: { in: salesIds } },
              select: { id: true, salesOrderId: true },
              orderBy: { id: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    const invoices =
      billing && (orderIds.length || saleLines.length)
        ? bounded(
            await this.prisma.customerInvoice.findMany({
              where: {
                tenantId,
                lines: {
                  some: {
                    OR: [
                      { transportOrderId: { in: orderIds } },
                      { salesOrderLineId: { in: saleLines.map((l) => l.id) } },
                    ],
                  },
                },
              },
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                lines: {
                  select: { transportOrderId: true, salesOrderLineId: true },
                  take: LIMIT + 1,
                },
              },
              orderBy: { createdAt: 'asc' },
              take: LIMIT + 1,
            }),
          )
        : [];
    for (const invoice of invoices) {
      add(
        'CUSTOMER_INVOICE',
        invoice.id,
        invoice.invoiceNumber,
        invoice.status,
        'billing',
        `/invoices?statement=${invoice.id}`,
      );
      for (const line of bounded(invoice.lines)) {
        if (line.transportOrderId && orderIds.includes(line.transportOrderId))
          link(
            'TRANSPORT_ORDER',
            line.transportOrderId,
            'CUSTOMER_INVOICE',
            invoice.id,
            'Facturation',
          );
        const sale = saleLines.find((l) => l.id === line.salesOrderLineId);
        if (sale)
          link(
            'SALES_ORDER',
            sale.salesOrderId,
            'CUSTOMER_INVOICE',
            invoice.id,
            'Facturation commerciale',
          );
      }
    }
    if (!crm || !transport || !planning || !wms || !billing)
      result.notices.push(
        'Vue limitée aux modules activés et aux permissions de votre compte. Une section absente n’indique pas une absence de données.',
      );
    result.notices.push(
      'Seuls les liens persistés sont affichés. Aucun lien de cour ni de fabrication n’est déduit artificiellement.',
    );
    const subjectType: Record<string, string> = {
      SALES_ORDER: 'sales-order',
      TRANSPORT_ORDER: 'transport-order',
      SHIPMENT: 'shipment',
      LOAD: 'load',
      PICK_ORDER: 'pick-order',
      CUSTOMER_INVOICE: 'customer-invoice',
    };
    const subjects = result.entities.map((e) => ({
      subjectType: subjectType[e.type],
      subjectId: e.id,
    }));
    const events = bounded(
      await this.prisma.domainEvent.findMany({
        where: { tenantId, OR: subjects },
        select: { id: true, type: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: LIMIT + 1,
      }),
    );
    result.activity.push(
      ...events.map((e) => ({
        id: e.id,
        kind: 'event' as const,
        label: e.type,
        status: e.status,
        at: e.createdAt.toISOString(),
      })),
    );
    if (user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ)) {
      const tasks = bounded(
        await this.prisma.operationalTask.findMany({
          where: { tenantId, OR: subjects },
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: LIMIT + 1,
        }),
      );
      result.activity.push(
        ...tasks.map((t) => ({
          id: t.id,
          kind: 'task' as const,
          label: t.title,
          status: t.status,
          at: t.createdAt.toISOString(),
          href: `/workbench?task=${t.id}`,
        })),
      );
      if (tasks.length && user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_READ)) {
        const actions = bounded(
          await this.prisma.proposedAction.findMany({
            where: { tenantId, triggeredByRef: { in: tasks.map((t) => `task:${t.id}`) } },
            select: { id: true, tool: true, status: true, proposedAt: true },
            orderBy: { proposedAt: 'desc' },
            take: LIMIT + 1,
          }),
        );
        result.activity.push(
          ...actions.map((a) => ({
            id: a.id,
            kind: 'action' as const,
            label: a.tool,
            status: a.status,
            at: a.proposedAt.toISOString(),
            href: '/agent-actions',
          })),
        );
      }
    }
    result.activity.sort((a, b) => b.at.localeCompare(a.at));
    const keys = new Set(result.entities.map((e) => key(e.type, e.id)));
    result.links = result.links.filter(
      (l, i, links) =>
        keys.has(l.from) &&
        keys.has(l.to) &&
        links.findIndex((x) => x.from === l.from && x.to === l.to && x.label === l.label) === i,
    );
    return result;
  }
}
