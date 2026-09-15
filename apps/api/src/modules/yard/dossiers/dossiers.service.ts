import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  MODULE_KEYS,
  PERMISSIONS,
  YARD_DOSSIER_KINDS,
  yardDateInZone,
  type AuthUser,
  type YardDossierKind,
  type YardDossierSource,
  type YardDossierContext,
  type YardDossierItem,
  type YardRelatedDossiers,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { AddDossierDto, DossierSourceParams } from './dossiers.dto';

type Db = PrismaService | Prisma.TransactionClient;
type Anchor = {
  type: YardDossierSource;
  id: string;
  number: string;
  locationId: string;
  direction: string;
  editable: boolean;
  sharedWithAppointment: boolean;
};
const field = (kind: YardDossierKind) =>
  kind === 'load' ? 'loadId' : kind === 'receipt' ? 'receiptId' : 'pickOrderId';
const table = (kind: YardDossierKind) =>
  kind === 'load' ? 'load' : kind === 'receipt' ? 'receipt' : 'pickOrder';
const sourceWhere = (a: Anchor) =>
  a.type === 'visit' ? { visitId: a.id } : { appointmentId: a.id };
const href = (kind: YardDossierKind, id: string) =>
  `${kind === 'load' ? '/loads' : kind === 'receipt' ? '/wms/receiving' : '/wms/picking'}/${encodeURIComponent(id)}`;

@Injectable()
export class YardDossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}

  private async available(u: AuthUser, kind: YardDossierKind) {
    const enabled = await this.modules.getEnabledKeys(u.tenantId);
    return (
      enabled.has(kind === 'load' ? MODULE_KEYS.TRANSPORTATION : MODULE_KEYS.WMS) &&
      u.permissions.includes(
        kind === 'load' ? PERMISSIONS.TRANSPORTATION.PLANNING_READ : PERMISSIONS.WMS.READ,
      )
    );
  }
  private async requireTarget(u: AuthUser, kind: YardDossierKind) {
    if (!(await this.available(u, kind)))
      throw new ForbiddenException('Module ou droit de lecture du dossier indisponible.');
  }
  private async anchor(u: AuthUser, p: DossierSourceParams, db: Db = this.prisma): Promise<Anchor> {
    let visitActive = true;
    let visitLocationId: string | undefined;
    if (p.source === 'visit') {
      const v = await db.yardVisit.findFirst({
        where: { tenantId: u.tenantId, id: p.id },
        select: {
          id: true,
          visitNumber: true,
          locationId: true,
          direction: true,
          status: true,
          appointmentId: true,
        },
      });
      if (!v) throw new NotFoundException('Visite introuvable.');
      visitActive = ['CHECKED_IN', 'ASSIGNED'].includes(v.status);
      if (!v.appointmentId)
        return {
          type: 'visit',
          id: v.id,
          number: v.visitNumber,
          locationId: v.locationId,
          direction: v.direction,
          editable: visitActive,
          sharedWithAppointment: false,
        };
      p = { source: 'appointment', id: v.appointmentId };
      visitLocationId = v.locationId;
    }
    const a = await db.dockAppointment.findFirst({
      where: { tenantId: u.tenantId, id: p.id },
      select: {
        id: true,
        appointmentNumber: true,
        locationId: true,
        direction: true,
        status: true,
      },
    });
    if (!a) throw new NotFoundException('Rendez-vous introuvable.');
    if (visitLocationId && visitLocationId !== a.locationId)
      throw new ConflictException(
        'La visite et son rendez-vous ne sont pas sur le même site : association à corriger.',
      );
    const departed = await db.yardVisit.count({
      where: { tenantId: u.tenantId, appointmentId: a.id, status: 'DEPARTED' },
    });
    return {
      type: 'appointment',
      id: a.id,
      number: a.appointmentNumber,
      locationId: a.locationId,
      direction: a.direction,
      editable: visitActive && !departed && ['SCHEDULED', 'ARRIVED'].includes(a.status),
      sharedWithAppointment: true,
    };
  }

  private loadScope(tenantId: string, a: Anchor): Prisma.LoadWhereInput {
    const shipmentSite =
      a.direction === 'INBOUND'
        ? { destinationLocationId: a.locationId }
        : a.direction === 'OUTBOUND'
          ? { originLocationId: a.locationId }
          : { OR: [{ originLocationId: a.locationId }, { destinationLocationId: a.locationId }] };
    return {
      OR: [
        { shipments: { some: { tenantId, status: { not: 'CANCELLED' }, ...shipmentSite } } },
        {
          route: {
            is: {
              tenantId,
              stops: {
                some: {
                  tenantId,
                  locationId: a.locationId,
                  ...(a.direction === 'OTHER'
                    ? {}
                    : { type: a.direction === 'INBOUND' ? 'DELIVERY' : 'PICKUP' }),
                },
              },
            },
          },
        },
      ],
    };
  }
  private async targets(
    u: AuthUser,
    kind: YardDossierKind,
    options: { ids?: string[]; anchor?: Anchor; q?: string; take?: number },
    db: Db = this.prisma,
  ): Promise<YardDossierItem[]> {
    const { ids, anchor: a, q, take = 101 } = options;
    const base = {
      tenantId: u.tenantId,
      ...(ids ? { id: { in: ids } } : {}),
      ...(a ? { status: { not: 'CANCELLED' as const } } : {}),
    };
    if (kind === 'load') {
      const rows = await db.load.findMany({
        where: {
          ...base,
          ...(a ? this.loadScope(u.tenantId, a) : {}),
          ...(q ? { loadNumber: { contains: q, mode: 'insensitive' } } : {}),
        },
        select: { id: true, loadNumber: true, status: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.loadNumber,
        status: r.status,
        href: href(kind, r.id),
      }));
    }
    if (
      a &&
      ((kind === 'receipt' && a.direction === 'OUTBOUND') ||
        (kind === 'pick-order' && a.direction === 'INBOUND'))
    )
      return [];
    const where = {
      ...base,
      ...(a ? { locationId: a.locationId } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: 'insensitive' as const } },
              { reference: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const args = {
      where,
      select: { id: true, number: true, status: true },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
      take,
    };
    const rows =
      kind === 'receipt' ? await db.receipt.findMany(args) : await db.pickOrder.findMany(args);
    return rows.map((r) => ({ ...r, href: href(kind, r.id) }));
  }

  async read(u: AuthUser, p: DossierSourceParams): Promise<YardDossierContext> {
    const a = await this.anchor(u, p);
    const groups = await Promise.all(
      YARD_DOSSIER_KINDS.map(async (kind) => {
        const available = await this.available(u, kind);
        if (!available) return { kind, available, items: [], truncated: false };
        const links = await this.prisma.yardDossierLink.findMany({
          where: { tenantId: u.tenantId, ...sourceWhere(a), [field(kind)]: { not: null } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 101,
        });
        const ids = links.slice(0, 100).map((l) => l[field(kind)]!);
        const [rows, compatible] = await Promise.all([
          this.targets(u, kind, { ids }),
          this.targets(u, kind, { ids, anchor: a }),
        ]);
        const valid = new Set(compatible.map((r) => r.id));
        return {
          kind,
          available,
          truncated: links.length > 100,
          items: rows.map((r) => ({
            ...r,
            linkId: links.find((l) => l[field(kind)] === r.id)!.id,
            ...(!valid.has(r.id)
              ? { warning: 'Dossier annulé ou contexte modifié : rattachement à revérifier.' }
              : {}),
          })),
        };
      }),
    );
    return {
      source: {
        type: a.type,
        id: a.id,
        number: a.number,
        locationId: a.locationId,
        sharedWithAppointment: a.sharedWithAppointment,
      },
      editable: a.editable && u.permissions.includes(PERMISSIONS.YARD.MANAGE),
      groups,
    };
  }
  async candidates(u: AuthUser, p: DossierSourceParams, kind: YardDossierKind, q?: string) {
    await this.requireTarget(u, kind);
    const a = await this.anchor(u, p);
    const rows = await this.targets(u, kind, { anchor: a, q: q?.trim(), take: 21 });
    return { items: rows.slice(0, 20), truncated: rows.length > 20 };
  }

  async add(u: AuthUser, p: DossierSourceParams, dto: AddDossierDto) {
    await this.requireTarget(u, dto.kind);
    await this.ownership.assertOwned(table(dto.kind), dto.targetId, u.tenantId);
    const initial = await this.anchor(u, p);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM locations WHERE id = ${initial.locationId} AND "tenantId" = ${u.tenantId} FOR UPDATE`;
      const a = await this.anchor(u, p, tx);
      if (!a.editable)
        throw new ConflictException(
          'Le passage en cour est terminé : ses associations sont en lecture seule.',
        );
      const where = { tenantId: u.tenantId, ...sourceWhere(a), [field(dto.kind)]: dto.targetId };
      const existing = await tx.yardDossierLink.findFirst({ where });
      if (existing) return { linkId: existing.id, created: false };
      if (!(await this.targets(u, dto.kind, { ids: [dto.targetId], anchor: a }, tx)).length)
        throw new BadRequestException(
          'Dossier incompatible : vérifiez le site, le sens de l’opération et le statut.',
        );
      if (
        (await tx.yardDossierLink.count({
          where: { tenantId: u.tenantId, ...sourceWhere(a), [field(dto.kind)]: { not: null } },
        })) >= 100
      )
        throw new BadRequestException('Limite de 100 associations par catégorie atteinte.');
      const link = await tx.yardDossierLink.create({ data: where });
      return { linkId: link.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        action: AuditAction.CREATE,
        entityType: 'yard-dossier-link',
        entityId: result.linkId,
        after: {
          sourceType: initial.type,
          sourceId: initial.id,
          kind: dto.kind,
          targetId: dto.targetId,
        },
      });
    return result;
  }
  async remove(u: AuthUser, p: DossierSourceParams, linkId: string) {
    const initial = await this.anchor(u, p);
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM locations WHERE id = ${initial.locationId} AND "tenantId" = ${u.tenantId} FOR UPDATE`;
      const a = await this.anchor(u, p, tx);
      if (!a.editable)
        throw new ConflictException(
          'Le passage en cour est terminé : ses associations sont en lecture seule.',
        );
      const link = await tx.yardDossierLink.findFirst({
        where: { id: linkId, tenantId: u.tenantId, ...sourceWhere(a) },
      });
      if (!link) return null;
      const kind = link.loadId ? 'load' : link.receiptId ? 'receipt' : 'pick-order';
      await this.requireTarget(u, kind);
      await tx.yardDossierLink.deleteMany({
        where: { id: link.id, tenantId: u.tenantId, ...sourceWhere(a) },
      });
      return { id: link.id, kind, targetId: link[field(kind)] };
    });
    if (removed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        action: AuditAction.DELETE,
        entityType: 'yard-dossier-link',
        entityId: removed.id,
        before: {
          sourceType: initial.type,
          sourceId: initial.id,
          kind: removed.kind,
          targetId: removed.targetId,
        },
      });
    return { removed: !!removed };
  }

  async related(u: AuthUser, kind: YardDossierKind, id: string): Promise<YardRelatedDossiers> {
    await this.requireTarget(u, kind);
    if (!(await this.targets(u, kind, { ids: [id] })).length)
      throw new NotFoundException('Dossier introuvable.');
    const site = { select: { name: true, timezone: true } };
    const rows = await this.prisma.yardDossierLink.findMany({
      where: { tenantId: u.tenantId, [field(kind)]: id },
      take: 101,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        visit: {
          select: {
            id: true,
            tenantId: true,
            visitNumber: true,
            locationId: true,
            status: true,
            location: site,
          },
        },
        appointment: {
          select: {
            id: true,
            tenantId: true,
            appointmentNumber: true,
            locationId: true,
            status: true,
            windowStart: true,
            location: site,
          },
        },
      },
    });
    const items: YardRelatedDossiers['items'] = [];
    for (const row of rows.slice(0, 100)) {
      const source = row.visit ?? row.appointment;
      if (!source || source.tenantId !== u.tenantId) continue;
      let date = '';
      if (row.appointment) {
        try {
          date = yardDateInZone(row.appointment.windowStart, source.location.timezone || 'UTC');
        } catch {
          date = yardDateInZone(row.appointment.windowStart, 'UTC');
        }
      }
      const query = new URLSearchParams({
        site: source.locationId,
        [row.visit ? 'visit' : 'appointment']: source.id,
        ...(date ? { date } : {}),
      });
      items.push({
        id: row.id,
        number: row.visit?.visitNumber ?? row.appointment!.appointmentNumber,
        kind: row.visit ? 'visit' : 'appointment',
        status: source.status,
        site: source.location.name,
        href: `/yard?${query}`,
      });
    }
    return { items, truncated: rows.length > 100 };
  }
}
