import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  DOMAIN_EVENT_TYPES,
  PortalChangeRequestKind,
  PortalChangeRequestStatus,
} from '@pulsar/shared';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PortalChangeRequestsService } from './portal-change-requests.service';
import type { PortalContext } from './portal.service';

const TENANT = 't1';
const CUSTOMER = 'c1';

const ctx: PortalContext = {
  tenantId: TENANT,
  customerId: CUSTOMER,
  customerName: 'Acme Foods',
  tenantName: 'Shipper Inc',
  settings: {},
  actor: { portalUserId: 'pu1', displayName: 'Jane Doe' },
};

interface Row {
  id: string;
  tenantId: string;
  customerId: string;
  portalUserId: string | null;
  orderId: string | null;
  shipmentId: string | null;
  kind: string;
  note: string;
  status: string;
  staffResponse: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  customer?: { name: string };
  portalUser?: { firstName: string; lastName: string; email: string } | null;
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'cr1',
    tenantId: TENANT,
    customerId: CUSTOMER,
    portalUserId: 'pu1',
    orderId: 'o1',
    shipmentId: null,
    kind: PortalChangeRequestKind.DATE,
    note: 'Please move the pickup to Friday',
    status: PortalChangeRequestStatus.OPEN,
    staffResponse: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    resolvedAt: null,
    customer: { name: 'Acme Foods' },
    portalUser: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.test' },
    ...over,
  };
}

function makeService(
  opts: {
    rows?: Row[];
    orders?: Array<{ id: string; orderNumber: string; customerId: string }>;
    shipments?: Array<{ id: string; shipmentNumber: string; customerId: string }>;
    updateCount?: number;
  } = {},
) {
  const rows = opts.rows ?? [];
  const orders = opts.orders ?? [{ id: 'o1', orderNumber: 'TO-000001', customerId: CUSTOMER }];
  const shipments = opts.shipments ?? [];
  const calls: string[] = [];

  const prisma = {
    transportOrder: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = orders.find(
          (o) =>
            o.id === where.id &&
            (where.customerId === undefined || o.customerId === where.customerId),
        );
        return found ? { id: found.id, orderNumber: found.orderNumber } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        orders
          .filter((o) => where.id.in.includes(o.id))
          .map((o) => ({ id: o.id, orderNumber: o.orderNumber })),
      ),
    },
    shipment: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const scope = where.transportOrder as { customerId?: string } | undefined;
        const found = shipments.find(
          (s) => s.id === where.id && (!scope?.customerId || s.customerId === scope.customerId),
        );
        return found ? { id: found.id, shipmentNumber: found.shipmentNumber } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        shipments
          .filter((s) => where.id.in.includes(s.id))
          .map((s) => ({ id: s.id, shipmentNumber: s.shipmentNumber })),
      ),
    },
    portalChangeRequest: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('create');
        const created = row({ ...(data as Partial<Row>), id: 'cr-new' });
        rows.push(created);
        return created;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            (where.customerId === undefined || r.customerId === where.customerId) &&
            (where.status === undefined || r.status === where.status),
        ),
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (opts.updateCount !== undefined) return { count: opts.updateCount };
          const target = rows.find(
            (r) => r.id === where.id && r.tenantId === where.tenantId && r.status === where.status,
          );
          if (!target) return { count: 0 };
          Object.assign(target, data);
          return { count: 1 };
        },
      ),
    },
  } as unknown as PrismaService;

  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditLogsService;
  const domainEvents = {
    emit: jest.fn(async () => {
      calls.push('emit');
    }),
  } as unknown as DomainEventsService;

  return {
    service: new PortalChangeRequestsService(prisma, audit, domainEvents),
    prisma,
    audit,
    domainEvents,
    rows,
    calls,
  };
}

describe('PortalChangeRequestsService — portal side', () => {
  it('persists the row BEFORE emitting the domain event (rule 54) and carries changeRequestId', async () => {
    const { service, domainEvents, calls } = makeService();

    const created = await service.createFor(ctx, {
      orderId: 'o1',
      kind: PortalChangeRequestKind.DATE,
      note: 'Friday please',
    });

    expect(calls).toEqual(['create', 'emit']);
    expect(created.status).toBe(PortalChangeRequestStatus.OPEN);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      TENANT,
      DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
      { type: 'transport-order', id: 'o1' },
      expect.objectContaining({ changeRequestId: 'cr-new', kind: PortalChangeRequestKind.DATE }),
    );
  });

  it('records the portal account behind the request', async () => {
    const { service, prisma } = makeService();
    await service.createFor(ctx, {
      orderId: 'o1',
      kind: PortalChangeRequestKind.CANCEL,
      note: 'cancel',
    });
    expect(prisma.portalChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        customerId: CUSTOMER,
        portalUserId: 'pu1',
        orderId: 'o1',
        shipmentId: null,
      }),
    });
  });

  it('a shared capability link (no actor) files an anonymous request', async () => {
    const { service, prisma } = makeService();
    const { actor: _actor, ...linkCtx } = ctx;
    await service.createFor(linkCtx, {
      orderId: 'o1',
      kind: PortalChangeRequestKind.OTHER,
      note: 'hello',
    });
    expect(prisma.portalChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ portalUserId: null }),
    });
  });

  it('refuses an order that belongs to another customer (404, no leak)', async () => {
    const { service } = makeService({
      orders: [{ id: 'o9', orderNumber: 'TO-000099', customerId: 'other-customer' }],
    });
    await expect(
      service.createFor(ctx, {
        orderId: 'o9',
        kind: PortalChangeRequestKind.DATE,
        note: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires an order or a shipment', async () => {
    const { service } = makeService();
    await expect(
      service.createFor(ctx, { kind: PortalChangeRequestKind.OTHER, note: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the customer projection exposes numbers, never tenantId/customerId/orderId (rule 10)', async () => {
    const { service } = makeService({ rows: [row()] });
    const list = await service.listFor(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: 'cr1',
      kind: PortalChangeRequestKind.DATE,
      note: 'Please move the pickup to Friday',
      status: PortalChangeRequestStatus.OPEN,
      staffResponse: null,
      orderNumber: 'TO-000001',
      shipmentNumber: null,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      resolvedAt: null,
    });
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('tenantId');
    expect(raw).not.toContain(CUSTOMER);
  });
});

describe('PortalChangeRequestsService — staff transitions', () => {
  it('acknowledges an OPEN request and audits the status change', async () => {
    const { service, audit, rows } = makeService({ rows: [row()] });
    const updated = await service.acknowledge(TENANT, 'cr1', 'u1');
    expect(updated.status).toBe(PortalChangeRequestStatus.ACKNOWLEDGED);
    expect(rows[0].resolvedAt).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: 'u1',
        action: AuditAction.STATUS_CHANGE,
        entityType: 'portal-change-request',
        entityId: 'cr1',
        before: { status: PortalChangeRequestStatus.OPEN },
        after: { status: PortalChangeRequestStatus.ACKNOWLEDGED },
      }),
    );
  });

  it('resolve stores the staff answer and stamps resolvedAt', async () => {
    const { service, rows } = makeService({
      rows: [row({ status: PortalChangeRequestStatus.ACKNOWLEDGED })],
    });
    const updated = await service.resolve(TENANT, 'cr1', 'u1', 'Rescheduled to Friday');
    expect(updated.status).toBe(PortalChangeRequestStatus.RESOLVED);
    expect(updated.staffResponse).toBe('Rescheduled to Friday');
    expect(rows[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('rejects an impossible transition (rule 2) with a 400 and no write', async () => {
    const { service, prisma } = makeService({
      rows: [row({ status: PortalChangeRequestStatus.RESOLVED })],
    });
    await expect(service.acknowledge(TENANT, 'cr1', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.portalChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('409 when the conditional claim loses the race (TOCTOU)', async () => {
    const { service, audit } = makeService({ rows: [row()], updateCount: 0 });
    await expect(service.resolve(TENANT, 'cr1', 'u1', 'done')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('404 on a request of another tenant', async () => {
    const { service } = makeService({ rows: [row({ tenantId: 'other-tenant' })] });
    await expect(service.acknowledge(TENANT, 'cr1', 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('the staff projection adds the company and the requester, still without tenantId', async () => {
    const { service } = makeService({ rows: [row()] });
    const [staffRow] = await service.list(TENANT);
    expect(staffRow.customerName).toBe('Acme Foods');
    expect(staffRow.requestedBy).toBe('Jane Doe');
    expect(staffRow.orderNumber).toBe('TO-000001');
    expect(JSON.stringify(staffRow)).not.toContain('tenantId');
  });
});
