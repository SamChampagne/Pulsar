import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  computeComplianceStatus,
  fleetDateKey,
  fleetDateWindow,
  MODULE_KEYS,
  PERMISSIONS,
  type AuthUser,
  type FleetAssetKind,
  type FleetOrderRow,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { FleetAgendaQuery, FleetWorkspaceQuery } from './workspace.dto';

const active = ['OPEN', 'IN_PROGRESS'] as const;
const assetSelect = {
  id: true,
  unitNumber: true,
  type: true,
  plate: true,
  status: true,
  carrierId: true,
} as const;
const orderSelect = {
  id: true,
  description: true,
  type: true,
  status: true,
  dueDate: true,
  vendor: true,
  openedAt: true,
  completedAt: true,
  updatedAt: true,
  costAmount: true,
  costCurrency: true,
  odometerKm: true,
  vehicle: { select: { id: true, unitNumber: true, status: true } },
  trailer: { select: { id: true, unitNumber: true, status: true } },
} as const;
export function fleetOrderRow(row: any): FleetOrderRow {
  const { vehicle, trailer, ...rest } = row;
  return {
    ...rest,
    dueDate: row.dueDate?.toISOString() ?? null,
    openedAt: row.openedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    costAmount: row.costAmount?.toString() ?? null,
    asset: vehicle
      ? { ...vehicle, kind: 'vehicle' }
      : trailer
        ? { ...trailer, kind: 'trailer' }
        : null,
  };
}
@Injectable()
export class FleetWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ModuleSettingsService,
    private readonly modules: TenantModulesCacheService,
  ) {}
  private where(tenantId: string, q: FleetWorkspaceQuery) {
    return {
      tenantId,
      ...(q.ownership === 'internal' ? { carrierId: null } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { unitNumber: { contains: q.search.trim(), mode: 'insensitive' } },
              { plate: { contains: q.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }
  async workspace(tenantId: string, q: FleetWorkspaceQuery) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const now = Date.now();
    const settings = await this.settings.resolve(tenantId, 'fleet');
    const warnDays = Number(settings.complianceExpiringWindowDays);
    return this.prisma.$transaction(
      async (tx) => {
        const delegate = tx[q.kind] as any;
        const where = this.where(tenantId, q);
        const [rows, total, groups] = await Promise.all([
          delegate.findMany({
            where,
            select: assetSelect,
            orderBy: [{ unitNumber: 'asc' }, { id: 'asc' }],
            skip,
            take,
          }),
          delegate.count({ where }),
          delegate.groupBy({
            by: ['status'],
            where: this.where(tenantId, { ...q, status: undefined, search: undefined }),
            _count: true,
          }),
        ]);
        const ids = rows.map((r: any) => r.id);
        const fk = q.kind === 'vehicle' ? 'vehicleId' : 'trailerId';
        const subjectType = q.kind === 'vehicle' ? 'VEHICLE' : 'TRAILER';
        const [orders, docs] = await Promise.all([
          tx.maintenanceOrder.groupBy({
            by: [fk],
            where: { tenantId, [fk]: { in: ids }, status: { in: [...active] } },
            _count: true,
          }),
          tx.complianceDocument.findMany({
            where: {
              tenantId,
              subjectType,
              subjectId: { in: ids },
              expiresAt: { lte: new Date(now + warnDays * 86400000) },
            },
            select: { subjectId: true, expiresAt: true },
          }),
        ]);
        const count = (s: string) => groups.find((r: any) => r.status === s)?._count ?? 0;
        return {
          generatedAt: new Date(now).toISOString(),
          summary: {
            total: groups.reduce((n: number, r: any) => n + r._count, 0),
            available: count('AVAILABLE'),
            inService: count('IN_SERVICE'),
            maintenance: count('MAINTENANCE'),
            retired: count('RETIRED'),
          },
          ...paginated(
            rows.map((r: any) => ({
              id: r.id,
              kind: q.kind,
              unitNumber: r.unitNumber,
              type: r.type,
              plate: r.plate,
              status: r.status,
              internal: r.carrierId === null,
              openOrders: orders.find((o: any) => o[fk] === r.id)?._count ?? 0,
              expiredDocuments: docs.filter(
                (d) =>
                  d.subjectId === r.id &&
                  computeComplianceStatus(d.expiresAt, now, warnDays) === 'EXPIRED',
              ).length,
              expiringDocuments: docs.filter(
                (d) =>
                  d.subjectId === r.id &&
                  computeComplianceStatus(d.expiresAt, now, warnDays) === 'EXPIRING',
              ).length,
            })),
            total,
            page,
            pageSize,
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async agenda(tenantId: string, q: FleetAgendaQuery) {
    let window: { from: string; until: string };
    try {
      window = fleetDateWindow(q.from ?? fleetDateKey(new Date()));
    } catch {
      throw new BadRequestException('Date de début invalide.');
    }
    const { page, pageSize, skip, take } = paginationArgs(q);
    const base = { tenantId, status: { in: [...active] }, [q.kind]: this.where(tenantId, q) };
    const buckets = {
      dated: { dueDate: { gte: new Date(window.from), lt: new Date(window.until) } },
      overdue: { dueDate: { lt: new Date(window.from) } },
      undated: { dueDate: null },
      history: { status: { in: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] } },
    };
    return this.prisma.$transaction(
      async (tx) => {
        const [rows, dated, overdue, undated, history, days] = await Promise.all([
          tx.maintenanceOrder.findMany({
            where: { ...base, ...buckets[q.bucket] },
            select: orderSelect,
            orderBy:
              q.bucket === 'history'
                ? [{ updatedAt: 'desc' }, { id: 'asc' }]
                : [{ dueDate: 'asc' }, { openedAt: 'asc' }, { id: 'asc' }],
            skip,
            take,
          }),
          tx.maintenanceOrder.count({ where: { ...base, ...buckets.dated } }),
          tx.maintenanceOrder.count({ where: { ...base, ...buckets.overdue } }),
          tx.maintenanceOrder.count({ where: { ...base, ...buckets.undated } }),
          tx.maintenanceOrder.count({ where: { ...base, ...buckets.history } }),
          Promise.all(
            Array.from({ length: 7 }, async (_, index) => {
              const start = new Date(new Date(window.from).getTime() + index * 86400000);
              const end = new Date(start.getTime() + 86400000);
              return {
                date: fleetDateKey(start),
                count: await tx.maintenanceOrder.count({
                  where: { ...base, dueDate: { gte: start, lt: end } },
                }),
              };
            }),
          ),
        ]);
        const counts = { dated, overdue, undated, history };
        return {
          ...window,
          generatedAt: new Date().toISOString(),
          counts,
          days,
          ...paginated(rows.map(fleetOrderRow), counts[q.bucket], page, pageSize),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async asset(user: AuthUser, kind: FleetAssetKind, id: string) {
    if (!['vehicle', 'trailer'].includes(kind))
      throw new BadRequestException('Type d’actif invalide.');
    const tenantId = user.tenantId;
    const settings = await this.settings.resolve(tenantId, 'fleet');
    const canReadTransport =
      user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ) &&
      (await this.modules.getEnabledKeys(tenantId)).has(MODULE_KEYS.TRANSPORTATION);
    return this.prisma.$transaction(
      async (tx) => {
        const asset = await (tx[kind] as any).findFirst({
          where: { tenantId, id },
          select: assetSelect,
        });
        if (!asset) throw new NotFoundException('Actif introuvable.');
        const fk = kind === 'vehicle' ? 'vehicleId' : 'trailerId';
        const woWhere = { tenantId, [fk]: id };
        const docWhere = {
          tenantId,
          subjectId: id,
          subjectType: kind === 'vehicle' ? ('VEHICLE' as const) : ('TRAILER' as const),
        };
        const [orders, orderTotal, docs, docTotal, loads] = await Promise.all([
          tx.maintenanceOrder.findMany({
            where: woWhere,
            select: orderSelect,
            orderBy: [
              { completedAt: { sort: 'desc', nulls: 'first' } },
              { openedAt: 'desc' },
              { id: 'asc' },
            ],
            take: 30,
          }),
          tx.maintenanceOrder.count({ where: woWhere }),
          tx.complianceDocument.findMany({
            where: docWhere,
            select: { id: true, docType: true, reference: true, expiresAt: true },
            orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
            take: 30,
          }),
          tx.complianceDocument.count({ where: docWhere }),
          canReadTransport
            ? tx.load.findMany({
                where: { tenantId, [fk]: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
                select: { id: true, loadNumber: true, status: true },
                take: 11,
                orderBy: { createdAt: 'desc' },
              })
            : Promise.resolve(null),
        ]);
        return {
          generatedAt: new Date().toISOString(),
          asset: { ...asset, kind, internal: asset.carrierId === null, carrierId: undefined },
          orders: {
            items: orders.map(fleetOrderRow),
            total: orderTotal,
            truncated: orderTotal > orders.length,
          },
          documents: {
            items: docs.map((d) => ({
              ...d,
              status: computeComplianceStatus(
                d.expiresAt,
                Date.now(),
                Number(settings.complianceExpiringWindowDays),
              ),
            })),
            total: docTotal,
            truncated: docTotal > docs.length,
          },
          transport:
            loads === null ? null : { items: loads.slice(0, 10), truncated: loads.length > 10 },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
