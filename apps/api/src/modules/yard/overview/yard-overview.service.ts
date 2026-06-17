import { Injectable } from '@nestjs/common';
import { computeDwell } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Read-only dashboard rollup + live board for the Yard module. All figures are
 * computed on read and tenant-scoped (rule 1). Spot occupancy is DERIVED from
 * the active visits pointing at a spot (CHECKED_IN/ASSIGNED) — never
 * denormalised (rule 34).
 */
@Injectable()
export class YardOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTomorrow = new Date(startToday.getTime() + 86400000);

    const [trucksInYard, doorCount, occupiedDoors, visitsWithoutSpot, appointmentsToday] =
      await Promise.all([
        this.prisma.yardVisit.count({
          where: { tenantId, status: { in: ['CHECKED_IN', 'ASSIGNED'] } },
        }),
        this.prisma.yardSpot.count({ where: { tenantId, type: 'DOCK_DOOR' } }),
        this.prisma.yardVisit.count({
          where: {
            tenantId,
            status: { in: ['CHECKED_IN', 'ASSIGNED'] },
            spot: { type: 'DOCK_DOOR' },
          },
        }),
        this.prisma.yardVisit.count({
          where: { tenantId, status: { in: ['CHECKED_IN', 'ASSIGNED'] }, spotId: null },
        }),
        this.prisma.dockAppointment.count({
          where: {
            tenantId,
            status: { in: ['SCHEDULED', 'ARRIVED'] },
            windowStart: { gte: startToday, lt: startTomorrow },
          },
        }),
      ]);

    // Continuity clocks (computed on read).
    const [activeVisits, lateAppointments] = await Promise.all([
      this.prisma.yardVisit.findMany({
        where: { tenantId, status: { in: ['CHECKED_IN', 'ASSIGNED'] }, checkOutAt: null },
        select: { checkInAt: true },
        take: 1000,
      }),
      this.prisma.dockAppointment.count({
        where: { tenantId, status: 'SCHEDULED', windowEnd: { lt: now } },
      }),
    ]);
    const detentionCount = activeVisits.filter(
      (v) => computeDwell({ checkInAt: v.checkInAt }, now).status === 'DETENTION',
    ).length;

    return {
      trucksInYard,
      doorCount,
      occupiedDoors,
      freeDoors: doorCount - occupiedDoors,
      visitsWithoutSpot,
      appointmentsToday,
      detentionCount,
      lateAppointments,
    };
  }

  async board(tenantId: string, locationId?: string) {
    const [rawSpots, unassigned] = await Promise.all([
      this.prisma.yardSpot.findMany({
        where: { tenantId, isActive: true, ...(locationId ? { locationId } : {}) },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        include: {
          visits: {
            where: { status: { in: ['CHECKED_IN', 'ASSIGNED'] } },
            take: 1,
            include: {
              trailer: { select: { unitNumber: true, plate: true } },
              carrier: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.yardVisit.findMany({
        where: {
          tenantId,
          status: { in: ['CHECKED_IN', 'ASSIGNED'] },
          spotId: null,
          ...(locationId ? { locationId } : {}),
        },
        take: 100,
        include: {
          trailer: { select: { unitNumber: true, plate: true } },
          carrier: { select: { name: true } },
        },
      }),
    ]);

    const spots = rawSpots.map(({ visits, ...spot }) => ({
      ...spot,
      occupyingVisit: visits[0] ?? null,
    }));

    return { spots, unassigned };
  }
}
