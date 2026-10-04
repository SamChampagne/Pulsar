import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  nextDeliveryOperation,
  type DeliveryOperationsPage,
  type DeliveryOperationRow,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginationArgs } from '../../../common/pagination';
import { DeliveryOperationsQuery } from './delivery-operations.dto';

/** All filters execute in SQL; pagination totals never come from a truncated collection. */
export function deliveryOperationsWhere(
  tenantId: string,
  query: DeliveryOperationsQuery,
): Prisma.LoadWhereInput {
  const where: Prisma.LoadWhereInput = {
    tenantId,
    ...(query.search?.trim()
      ? { loadNumber: { contains: query.search.trim(), mode: 'insensitive' } }
      : {}),
  };
  const exception = (
    status: ('OPEN' | 'RETRY_PLANNED' | 'RETURN_AUTHORIZED' | 'RETURN_RECEIVED')[],
  ) => ({ some: { tenantId, status: { in: status } } });
  switch (query.filter ?? 'all') {
    case 'to_prepare':
      return {
        ...where,
        status: { in: ['OPEN', 'PLANNED'] },
        shipments: {
          some: {
            tenantId,
            status: { not: 'CANCELLED' },
            deliveryPackages: { none: { tenantId, status: { not: 'CANCELLED' } } },
          },
        },
      };
    case 'to_load':
      return {
        ...where,
        status: { in: ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'] },
        shipments: {
          some: {
            tenantId,
            status: { not: 'CANCELLED' },
            deliveryPackages: { some: { tenantId, status: 'PREPARED' } },
          },
        },
      };
    case 'in_delivery':
      return { ...where, status: 'IN_TRANSIT' };
    case 'blocked':
      return { ...where, deliveryExceptions: exception(['OPEN']) };
    case 'retry':
      return { ...where, deliveryExceptions: exception(['RETRY_PLANNED']) };
    case 'returns':
      return { ...where, deliveryExceptions: exception(['RETURN_AUTHORIZED', 'RETURN_RECEIVED']) };
    default:
      return where;
  }
}

@Injectable()
export class DeliveryOperationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(tenantId: string, query: DeliveryOperationsQuery): Promise<DeliveryOperationsPage> {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = deliveryOperationsWhere(tenantId, query);
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.load.count({ where });
        const loads = await tx.load.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
          select: {
            id: true,
            loadNumber: true,
            status: true,
            updatedAt: true,
            _count: { select: { shipments: { where: { tenantId } } } },
          },
        });
        const ids = loads.map((load) => load.id);
        if (!ids.length)
          return { items: [], total, page, pageSize, observedAt: new Date().toISOString() };
        const packageCounts = await tx.$queryRaw<
          { loadId: string; status: string; count: number }[]
        >(Prisma.sql`
        SELECT s."loadId" AS "loadId", p.status::text AS status, COUNT(*)::int AS count
        FROM delivery_packages p JOIN shipments s ON s.id = p."shipmentId" AND s."tenantId" = p."tenantId"
        WHERE p."tenantId" = ${tenantId} AND s."tenantId" = ${tenantId} AND s."loadId" IN (${Prisma.join(ids)})
        GROUP BY s."loadId", p.status`);
        const exceptions = await tx.deliveryException.groupBy({
          by: ['loadId', 'status'],
          where: {
            tenantId,
            loadId: { in: ids },
            status: { in: ['OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED', 'RETURN_RECEIVED'] },
          },
          _count: { _all: true },
        });
        const withoutPackages = await tx.shipment.groupBy({
          by: ['loadId'],
          where: {
            tenantId,
            loadId: { in: ids },
            status: { not: 'CANCELLED' },
            deliveryPackages: { none: { tenantId, status: { not: 'CANCELLED' } } },
          },
          _count: { _all: true },
        });
        const items = loads.map((load) => {
          const packages = {
            total: 0,
            prepared: 0,
            loaded: 0,
            delivered: 0,
            returned: 0,
            cancelled: 0,
          };
          for (const count of packageCounts.filter((row) => row.loadId === load.id)) {
            const key = count.status.toLowerCase() as Exclude<keyof typeof packages, 'total'>;
            if (Object.hasOwn(packages, key)) packages[key] = count.count;
            packages.total += count.count;
          }
          const cases = { open: 0, retry: 0, returnAuthorized: 0, returnReceived: 0 };
          for (const row of exceptions.filter((row) => row.loadId === load.id)) {
            const key = (
              {
                OPEN: 'open',
                RETRY_PLANNED: 'retry',
                RETURN_AUTHORIZED: 'returnAuthorized',
                RETURN_RECEIVED: 'returnReceived',
                RESOLVED: undefined,
              } as const
            )[row.status];
            if (key) cases[key] = row._count._all;
          }
          const row: Omit<DeliveryOperationRow, 'nextAction'> = {
            id: load.id,
            loadNumber: load.loadNumber,
            status: load.status,
            updatedAt: load.updatedAt.toISOString(),
            shipmentCount: load._count.shipments,
            shipmentsWithoutPackages:
              withoutPackages.find((entry) => entry.loadId === load.id)?._count._all ?? 0,
            packages,
            exceptions: cases,
          };
          return { ...row, nextAction: nextDeliveryOperation(row) };
        });
        return { items, total, page, pageSize, observedAt: new Date().toISOString() };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
