import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { AuditAction, yardDateInZone, yardDayRange, type YardPlanShape } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { SaveYardPlanDto, WorkspaceQueryDto } from './workspace.dto';

const siteSelect = { id: true, code: true, name: true, timezone: true } as const;
const spotSelect = {
  id: true,
  code: true,
  type: true,
  isActive: true,
  posX: true,
  posY: true,
} as const;
const shapesOf = (value: Prisma.JsonValue | null): YardPlanShape[] =>
  Array.isArray(value) ? (value as unknown as YardPlanShape[]) : [];
const versionOf = (
  shapes: YardPlanShape[],
  spots: { id: string; posX: number | null; posY: number | null }[],
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        shapes,
        [...spots].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.id, s.posX, s.posY]),
      ]),
    )
    .digest('hex');

@Injectable()
export class YardWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  async sites(tenantId: string) {
    // Yard-only users can select a site without permission to the TMS module.
    const items = await this.prisma.location.findMany({
      where: { tenantId, isActive: true },
      select: siteSelect,
      orderBy: [{ yardSpots: { _count: 'desc' } }, { name: 'asc' }, { id: 'asc' }],
      take: 501,
    });
    return { items: items.slice(0, 500), truncated: items.length > 500 };
  }
  async read(tenantId: string, query: WorkspaceQueryDto) {
    const location = await this.prisma.location.findFirst({
      where: { id: query.locationId, tenantId },
      select: { ...siteSelect, yardPlan: true },
    });
    if (!location) throw new NotFoundException('Site introuvable.');
    const now = new Date();
    let today: string;
    try {
      today = yardDateInZone(now, location.timezone || 'UTC');
    } catch {
      today = now.toISOString().slice(0, 10);
    }
    const date = query.date || today;
    let range: ReturnType<typeof yardDayRange>;
    try {
      range = yardDayRange(date, location.timezone);
    } catch {
      throw new BadRequestException('Date invalide.');
    }
    const scope = { tenantId, locationId: location.id };
    const [spots, visits, appointments] = await Promise.all([
      this.prisma.yardSpot.findMany({
        where: scope,
        select: spotSelect,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: 501,
      }),
      this.prisma.yardVisit.findMany({
        where: { ...scope, status: { in: ['CHECKED_IN', 'ASSIGNED'] } },
        orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
        take: 501,
        select: {
          id: true,
          visitNumber: true,
          status: true,
          direction: true,
          spotId: true,
          appointmentId: true,
          trailerRef: true,
          driverName: true,
          checkInAt: true,
          trailer: { select: { unitNumber: true, plate: true } },
          carrier: { select: { name: true } },
        },
      }),
      this.prisma.dockAppointment.findMany({
        where: {
          ...scope,
          windowStart: { lt: new Date(range.end) },
          windowEnd: { gt: new Date(range.start) },
        },
        orderBy: [{ windowStart: 'asc' }, { id: 'asc' }],
        take: 501,
        select: {
          id: true,
          appointmentNumber: true,
          status: true,
          direction: true,
          spotId: true,
          carrierId: true,
          windowStart: true,
          windowEnd: true,
          reference: true,
          notes: true,
          carrier: { select: { name: true } },
        },
      }),
    ]);
    const { yardPlan, ...site } = location,
      shapes = shapesOf(yardPlan);
    return {
      site,
      date,
      ...range,
      generatedAt: now.toISOString(),
      shapes,
      planVersion: versionOf(shapes, spots),
      spots: spots.slice(0, 500),
      visits: visits.slice(0, 500),
      appointments: appointments.slice(0, 500),
      truncated: {
        spots: spots.length > 500,
        visits: visits.length > 500,
        appointments: appointments.length > 500,
      },
    };
  }
  async savePlan(tenantId: string, userId: string, locationId: string, dto: SaveYardPlanDto) {
    await this.ownership.assertOwned('location', locationId, tenantId);
    if (
      new Set(dto.shapes.map((s) => s.id)).size !== dto.shapes.length ||
      new Set(dto.positions.map((p) => p.id)).size !== dto.positions.length
    )
      throw new BadRequestException('Identifiants répétés dans le plan.');
    if (dto.shapes.some((s) => s.x + s.width > 64 || s.y + s.height > 64 || !s.label.trim()))
      throw new BadRequestException('Élément hors des limites du plan.');
    if (dto.positions.some((p) => (p.posX == null) !== (p.posY == null)))
      throw new BadRequestException('Les deux coordonnées sont requises ensemble.');
    const cells = dto.positions.filter((p) => p.posX != null).map((p) => `${p.posX},${p.posY}`);
    if (new Set(cells).size !== cells.length)
      throw new BadRequestException(
        'Deux emplacements ne peuvent pas occuper la même cellule du dessin.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const site = await tx.location.findFirst({
        where: { id: locationId, tenantId },
        select: { yardPlan: true },
      });
      if (!site) throw new NotFoundException('Site introuvable.');
      const spots = await tx.yardSpot.findMany({
        where: { tenantId, locationId },
        select: spotSelect,
      });
      if (versionOf(shapesOf(site.yardPlan), spots) !== dto.expectedVersion)
        throw new ConflictException(
          'Le plan a changé. Rechargez-le avant de modifier la disposition.',
        );
      if (
        spots.length !== dto.positions.length ||
        dto.positions.some((p) => !spots.some((s) => s.id === p.id))
      )
        throw new BadRequestException(
          'Le plan doit contenir exactement les emplacements de ce site.',
        );
      for (const p of dto.positions)
        await tx.yardSpot.updateMany({
          where: { id: p.id, tenantId, locationId },
          data: { posX: p.posX ?? null, posY: p.posY ?? null },
        });
      await tx.location.updateMany({
        where: { id: locationId, tenantId },
        data: { yardPlan: dto.shapes as unknown as Prisma.InputJsonValue },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'yard-plan',
      entityId: locationId,
      after: { shapes: dto.shapes, positions: dto.positions },
    });
    return { saved: true };
  }
}
