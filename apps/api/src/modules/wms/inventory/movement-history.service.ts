import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import type { WmsMovementRow } from '@pulsar/shared';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { MovementListQueryDto } from './dto/inventory.dto';

const binSelect = {
  id: true,
  code: true,
  locationId: true,
  location: { select: { name: true } },
} as const;
@Injectable()
export class MovementHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}
  async list(tenantId: string, q: MovementListQueryDto, serviceContext = false) {
    await this.ownership.assertOwnedIfSet('wmsItem', q.itemId, tenantId);
    await this.ownership.assertOwnedIfSet('bin', q.binId, tenantId);
    await this.ownership.assertOwnedIfSet('location', q.locationId, tenantId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const and: Prisma.StockMovementWhereInput[] = [];
    if (q.binId) and.push({ OR: [{ fromBinId: q.binId }, { toBinId: q.binId }] });
    if (q.locationId)
      and.push({
        OR: [
          { fromBin: { tenantId, locationId: q.locationId } },
          { toBin: { tenantId, locationId: q.locationId } },
        ],
      });
    const search = q.search?.trim().slice(0, 120);
    if (search)
      and.push({
        OR: [
          { item: { tenantId, sku: { contains: search, mode: 'insensitive' } } },
          { item: { tenantId, name: { contains: search, mode: 'insensitive' } } },
          { fromBin: { tenantId, code: { contains: search, mode: 'insensitive' } } },
          { toBin: { tenantId, code: { contains: search, mode: 'insensitive' } } },
          { note: { contains: search, mode: 'insensitive' } },
        ],
      });
    const where: Prisma.StockMovementWhereInput = {
      tenantId,
      AND: and,
      ...(q.itemId ? { itemId: q.itemId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.refId ? { refId: q.refId } : {}),
      ...(q.refType ? { refType: q.refType } : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.stockMovement.findMany({
            where,
            skip,
            take,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              type: true,
              qty: true,
              unitSnapshot: true,
              note: true,
              createdAt: true,
              createdById: true,
              refId: true,
              refType: true,
              item: { select: { id: true, sku: true, name: true, unit: true } },
              fromBin: { select: binSelect },
              toBin: { select: binSelect },
            },
          }),
          tx.stockMovement.count({ where }),
        ]);
        const ids = (type: string) =>
          rows.filter((r) => r.refType === type && r.refId).map((r) => r.refId!);
        const [users, receipts, picks, counts, serviceJobs] = await Promise.all([
          tx.user.findMany({
            where: {
              tenantId,
              id: { in: rows.map((r) => r.createdById).filter((id): id is string => !!id) },
            },
            select: { id: true, firstName: true, lastName: true },
          }),
          tx.receipt.findMany({
            where: { tenantId, id: { in: ids('receipt') } },
            select: { id: true, number: true },
          }),
          tx.pickOrder.findMany({
            where: { tenantId, id: { in: ids('pick-order') } },
            select: { id: true, number: true },
          }),
          tx.cycleCount.findMany({
            where: { tenantId, id: { in: ids('cycle-count') } },
            select: { id: true, number: true },
          }),
          serviceContext
            ? tx.serviceJob.findMany({
                where: { tenantId, id: { in: ids('service-job') } },
                select: { id: true, number: true },
              })
            : Promise.resolve([]),
        ]);
        const actor = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
        const sources = new Map<string, WmsMovementRow['source']>();
        for (const [kind, docs] of [
          ['receipt', receipts],
          ['pick-order', picks],
          ['cycle-count', counts],
          ['service-job', serviceJobs],
        ] as const)
          for (const d of docs) sources.set(`${kind}:${d.id}`, { ...d, kind });
        const bin = (b: (typeof rows)[number]['fromBin']) =>
          b
            ? {
                id: b.id,
                code: b.code,
                locationId: b.locationId,
                locationName: b.location.name,
              }
            : null;
        const items: WmsMovementRow[] = rows.map((r) => ({
          id: r.id,
          type: r.type,
          createdAt: r.createdAt.toISOString(),
          qty: r.qty.toString(),
          item: { id: r.item.id, sku: r.item.sku, name: r.item.name },
          unit: r.unitSnapshot ?? r.item.unit,
          unitCaptured: r.unitSnapshot !== null,
          fromBin: bin(r.fromBin),
          toBin: bin(r.toBin),
          note: r.note,
          actor: r.createdById ? (actor.get(r.createdById) ?? null) : null,
          source: sources.get(`${r.refType}:${r.refId}`) ?? null,
        }));
        return {
          ...paginated(items, total, page, pageSize),
          generatedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
