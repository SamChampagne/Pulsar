import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import type { WmsBinDetail, WmsVisualBin, WmsWorkspace } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { WmsPageQuery, WmsWorkspaceQuery, WmsSitesQuery } from './workspace.dto';

const siteSelect = { id: true, code: true, name: true, type: true } as const;
const binSelect = { id: true, code: true, kind: true, zone: true, isActive: true } as const;
const documentSelect = {
  id: true,
  number: true,
  status: true,
  reference: true,
  createdAt: true,
  _count: { select: { lines: true } },
} as const;
@Injectable()
export class WmsWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}
  async site(tenantId: string, id: string) {
    const site = await this.prisma.location.findFirst({
      where: { tenantId, id, type: 'WAREHOUSE' },
      select: siteSelect,
    });
    if (!site) throw new NotFoundException('Entrepôt introuvable.');
    return site;
  }
  async sites(tenantId: string, q: WmsSitesQuery) {
    q.q = q.search ?? q.q;
    const where: Prisma.LocationWhereInput = {
      tenantId,
      type: 'WAREHOUSE',
      ...(q.q?.trim()
        ? {
            OR: [
              { code: { contains: q.q.trim(), mode: 'insensitive' } },
              { name: { contains: q.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        select: siteSelect,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  async items(tenantId: string, q: WmsSitesQuery) {
    const search = (q.search ?? q.q)?.trim();
    const where: Prisma.WmsItemWhereInput = {
      tenantId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.wmsItem.findMany({
        where,
        select: { id: true, sku: true, name: true, unit: true, isActive: true },
        orderBy: [{ sku: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.wmsItem.count({ where }),
    ]);
    return {
      items: items.map((i) => ({ ...i, name: `${i.sku} — ${i.name} · ${i.unit}` })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async item(tenantId: string, id: string) {
    const item = await this.prisma.wmsItem.findFirst({
      where: { tenantId, id },
      select: { id: true, sku: true, name: true, unit: true, isActive: true },
    });
    if (!item) throw new NotFoundException('Article introuvable.');
    return { ...item, name: `${item.sku} — ${item.name} · ${item.unit}` };
  }
  async siteBins(tenantId: string, locationId: string, q: WmsSitesQuery) {
    await this.site(tenantId, locationId);
    const search = (q.search ?? q.q)?.trim();
    const where: Prisma.BinWhereInput = {
      tenantId,
      locationId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { zone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bin.findMany({
        where,
        select: { ...binSelect, locationId: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.bin.count({ where }),
    ]);
    return {
      items: items.map((b) => ({ ...b, name: [b.code, b.zone].filter(Boolean).join(' · ') })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async siteBin(tenantId: string, locationId: string, id: string) {
    await this.site(tenantId, locationId);
    const bin = await this.prisma.bin.findFirst({
      where: { tenantId, locationId, id },
      select: { ...binSelect, locationId: true },
    });
    if (!bin) throw new NotFoundException('Emplacement introuvable dans cet entrepôt.');
    return { ...bin, name: [bin.code, bin.zone].filter(Boolean).join(' · ') };
  }
  async putaway(tenantId: string, q: WmsWorkspaceQuery) {
    const pageSize = 30;
    return this.prisma.$transaction(
      async (tx) => {
        const site = await tx.location.findFirst({
          where: { tenantId, id: q.locationId, type: 'WAREHOUSE' },
          select: siteSelect,
        });
        if (!site) throw new NotFoundException('Entrepôt introuvable.');
        const search = q.q?.trim();
        const where: Prisma.InventoryLevelWhereInput = {
          tenantId,
          qtyOnHand: { gt: 0 },
          bin: { tenantId, locationId: site.id, kind: 'RECEIVING' },
          ...(search
            ? {
                OR: [
                  { item: { tenantId, sku: { contains: search, mode: 'insensitive' } } },
                  { item: { tenantId, name: { contains: search, mode: 'insensitive' } } },
                  { bin: { tenantId, code: { contains: search, mode: 'insensitive' } } },
                  { bin: { tenantId, zone: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        };
        const [levels, total] = await Promise.all([
          tx.inventoryLevel.findMany({
            where,
            skip: (q.page - 1) * pageSize,
            take: pageSize,
            orderBy: [{ bin: { code: 'asc' } }, { item: { sku: 'asc' } }, { id: 'asc' }],
            select: {
              itemId: true,
              binId: true,
              qtyOnHand: true,
              item: { select: { sku: true, name: true, unit: true, isActive: true } },
              bin: { select: { code: true, zone: true, isActive: true } },
            },
          }),
          tx.inventoryLevel.count({ where }),
        ]);
        return {
          site,
          generatedAt: new Date().toISOString(),
          total,
          page: q.page,
          pageSize,
          items: levels.map((l) => ({
            ...l.item,
            itemId: l.itemId,
            binId: l.binId,
            binCode: l.bin.code,
            zone: l.bin.zone,
            binActive: l.bin.isActive,
            locationId: site.id,
            qtyOnHand: l.qtyOnHand.toString(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async visualBins(
    db: Prisma.TransactionClient,
    tenantId: string,
    where: Prisma.BinWhereInput,
    skip = 0,
    take = 80,
  ): Promise<WmsVisualBin[]> {
    const bins = await db.bin.findMany({
      where: { ...where, tenantId },
      select: binSelect,
      orderBy: [{ kind: 'asc' }, { zone: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      skip,
      take,
    });
    const ids = bins.map((b) => b.id);
    const [positive, negative] = await Promise.all([
      db.inventoryLevel.groupBy({
        by: ['binId'],
        where: { tenantId, binId: { in: ids }, qtyOnHand: { gt: 0 } },
        _count: true,
      }),
      db.inventoryLevel.groupBy({
        by: ['binId'],
        where: { tenantId, binId: { in: ids }, qtyOnHand: { lt: 0 } },
        _count: true,
      }),
    ]);
    const pos = new Map(positive.map((r) => [r.binId, r._count]));
    const neg = new Map(negative.map((r) => [r.binId, r._count]));
    return bins.map((b) => ({
      ...b,
      stockedItems: pos.get(b.id) ?? 0,
      negativeItems: neg.get(b.id) ?? 0,
    }));
  }
  async workspace(tenantId: string, q: WmsWorkspaceQuery): Promise<WmsWorkspace> {
    // Counts and displayed lanes come from one consistent read snapshot, without storing rollups.
    return this.prisma.$transaction(
      async (db) => {
        const site = await db.location.findFirst({
          where: { tenantId, id: q.locationId, type: 'WAREHOUSE' },
          select: siteSelect,
        });
        if (!site) throw new NotFoundException('Entrepôt introuvable.');
        const base = { tenantId, locationId: site.id };
        const binWhere: Prisma.BinWhereInput = {
          ...base,
          ...(q.q?.trim()
            ? {
                OR: [
                  { code: { contains: q.q.trim(), mode: 'insensitive' } },
                  { zone: { contains: q.q.trim(), mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        const stocked = { some: { tenantId, qtyOnHand: { gt: 0 } } };
        const putawayWhere: Prisma.BinWhereInput = { ...base, kind: 'RECEIVING', levels: stocked };
        const docs = async (kind: 'receipt' | 'pickOrder', status: 'DRAFT' | 'OPEN' | 'PICKED') => {
          if (kind === 'receipt') {
            const where = { ...base, status: 'DRAFT' as const };
            const [items, total] = await Promise.all([
              db.receipt.findMany({
                where,
                select: documentSelect,
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: 20,
              }),
              db.receipt.count({ where }),
            ]);
            return {
              items: items.map(({ _count, createdAt, ...r }) => ({
                ...r,
                createdAt: createdAt.toISOString(),
                lineCount: _count.lines,
              })),
              total,
            };
          }
          const where = { ...base, status: status as 'OPEN' | 'PICKED' };
          const [items, total] = await Promise.all([
            db.pickOrder.findMany({
              where,
              select: documentSelect,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 20,
            }),
            db.pickOrder.count({ where }),
          ]);
          return {
            items: items.map(({ _count, createdAt, ...r }) => ({
              ...r,
              createdAt: createdAt.toISOString(),
              lineCount: _count.lines,
            })),
            total,
          };
        };
        const [
          bins,
          total,
          allBins,
          stockedBins,
          inactiveBins,
          negativeLevels,
          cycleCounts,
          receiving,
          picking,
          finishing,
          putaway,
          putawayTotal,
        ] = await Promise.all([
          this.visualBins(db, tenantId, binWhere, (q.page - 1) * 80),
          db.bin.count({ where: binWhere }),
          db.bin.count({ where: base }),
          db.bin.count({ where: { ...base, levels: stocked } }),
          db.bin.count({ where: { ...base, isActive: false } }),
          db.inventoryLevel.count({
            where: { tenantId, bin: { tenantId, locationId: site.id }, qtyOnHand: { lt: 0 } },
          }),
          db.cycleCount.count({
            where: {
              tenantId,
              bin: { tenantId, locationId: site.id },
              status: { in: ['OPEN', 'COUNTED'] },
            },
          }),
          docs('receipt', 'DRAFT'),
          docs('pickOrder', 'OPEN'),
          docs('pickOrder', 'PICKED'),
          this.visualBins(db, tenantId, putawayWhere, 0, 20),
          db.bin.count({ where: putawayWhere }),
        ]);
        return {
          site: { ...site, type: 'WAREHOUSE' },
          generatedAt: new Date().toISOString(),
          bins: { items: bins, total, page: q.page, pageSize: 80 },
          summary: { bins: allBins, stockedBins, inactiveBins, negativeLevels, cycleCounts },
          receiving,
          picking,
          finishing,
          putaway: { items: putaway, total: putawayTotal },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async bin(tenantId: string, id: string, q: WmsPageQuery): Promise<WmsBinDetail> {
    return this.prisma.$transaction(
      async (db) => {
        const bin = await db.bin.findFirst({
          where: { tenantId, id },
          select: { ...binSelect, locationId: true, updatedAt: true },
        });
        if (!bin) throw new NotFoundException('Emplacement introuvable.');
        const where: Prisma.InventoryLevelWhereInput = {
          tenantId,
          binId: id,
          ...(q.q?.trim()
            ? {
                item: {
                  tenantId,
                  OR: [
                    { sku: { contains: q.q.trim(), mode: 'insensitive' } },
                    { name: { contains: q.q.trim(), mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        };
        const [rows, total, visual] = await Promise.all([
          db.inventoryLevel.findMany({
            where,
            select: {
              itemId: true,
              qtyOnHand: true,
              item: { select: { sku: true, name: true, unit: true, isActive: true } },
            },
            orderBy: [{ item: { sku: 'asc' } }, { id: 'asc' }],
            skip: (q.page - 1) * 50,
            take: 50,
          }),
          db.inventoryLevel.count({ where }),
          this.visualBins(db, tenantId, { id }, 0, 1),
        ]);
        return {
          bin: { ...bin, ...visual[0], updatedAt: bin.updatedAt.toISOString() },
          levels: {
            items: rows.map((r) => ({
              itemId: r.itemId,
              ...r.item,
              qtyOnHand: r.qtyOnHand.toString(),
            })),
            total,
            page: q.page,
            pageSize: 50,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
