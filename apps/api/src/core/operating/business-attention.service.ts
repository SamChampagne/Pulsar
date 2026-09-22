import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  ATTENTION_KINDS,
  ATTENTION_LABELS,
  AttentionFeed,
  BusinessAttentionItem as AttentionItem,
  BusinessAttentionKind as AttentionKind,
  AuthUser,
  ConnectedOperationsSettings,
  PERMISSIONS,
  connectedOperationsSettings,
  hrAvailabilityDate,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { paginationArgs } from '../../common/pagination';

const access = {
  support: ['support', PERMISSIONS.SUPPORT.READ],
  quality: ['quality', PERMISSIONS.QUALITY.READ],
  time: ['services', PERMISSIONS.SERVICES.TIME_APPROVE],
  purchasing: ['purchasing', PERMISSIONS.PURCHASING.READ],
  qualifications: ['hr', PERMISSIONS.HR.READ],
} as const;
const assignee = { firstName: true, lastName: true } as const;
const person = (p: { firstName: string; lastName: string } | null) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : null;
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

@Injectable()
export class BusinessAttentionService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  async settings(tenantId: string) {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true, updatedAt: true },
    });
    return {
      settings: connectedOperationsSettings(
        (tenant.settings as Record<string, unknown>)?.connectedOperations,
      ),
      settingsVersion: tenant.updatedAt.toISOString(),
    };
  }

  async updateSettings(
    actor: AuthUser,
    dto: ConnectedOperationsSettings & { expectedUpdatedAt: string },
  ) {
    if (!actor.permissions.includes(PERMISSIONS.CORE.TENANT_MANAGE)) throw new ForbiddenException();
    try {
      new Intl.DateTimeFormat('en', { timeZone: dto.timeZone }).format();
    } catch {
      throw new BadRequestException('Fuseau IANA invalide.');
    }
    const { expectedUpdatedAt, ...settings } = dto;
    const updated = await this.db.$executeRaw`
      UPDATE tenants SET settings = jsonb_set(settings, '{connectedOperations}', ${JSON.stringify(settings)}::jsonb, true),
      "updatedAt" = GREATEST(DATE_TRUNC('milliseconds', NOW()), "updatedAt" + interval '1 millisecond')
      WHERE id = ${actor.tenantId} AND "updatedAt" = ${new Date(expectedUpdatedAt)}`;
    if (updated !== 1) throw new ConflictException('Les réglages ont changé. Rechargez-les.');
    return this.settings(actor.tenantId);
  }

  async list(
    actor: AuthUser,
    query: { kind?: AttentionKind; page?: number; pageSize?: number; scope?: 'all' | 'mine' },
  ): Promise<AttentionFeed> {
    if (!actor.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ))
      throw new ForbiddenException();
    const [config, modules] = await Promise.all([
      this.settings(actor.tenantId),
      this.modules.getEnabledKeys(actor.tenantId),
    ]);
    const kinds = ATTENTION_KINDS.filter(
      (k) =>
        config.settings.enabled[k] &&
        modules.has(access[k][0]) &&
        actor.permissions.includes(access[k][1]) &&
        (k !== 'time' || actor.permissions.includes(PERMISSIONS.SERVICES.READ)),
    );
    if (query.kind && !kinds.includes(query.kind))
      throw new ForbiddenException('Cette source est désactivée ou non accessible.');
    const kind = query.kind ?? kinds[0] ?? null;
    const { page, pageSize, skip, take } = paginationArgs(query);
    const today = hrAvailabilityDate(new Date().toISOString(), config.settings.timeZone);
    const start = new Date(today + 'T00:00:00Z');
    const horizon = new Date(start.getTime() + config.settings.qualificationDays * 86400000);
    const tenantId = actor.tenantId;
    const mine = query.scope === 'mine';
    return this.db.$transaction(
      async (tx) => {
        const source = async (
          k: AttentionKind,
          rows: boolean,
        ): Promise<{ total: number; items: AttentionItem[] }> => {
          if (k === 'support' || k === 'quality') {
            const where = {
              tenantId,
              status: { in: ['OPEN', 'IN_PROGRESS'] as any },
              ...(mine ? { assigneeUserId: actor.id } : {}),
              ...(k === 'support'
                ? { OR: [{ assigneeUserId: null }, { dueDate: { lt: start } }] }
                : {}),
            };
            const delegate = k === 'support' ? tx.supportCase : tx.qualityNonconformity;
            // Both sources use the same assignment/status projection, not their confidential content.
            const total = await (delegate.count as any)({ where });
            const records = rows
              ? await (delegate.findMany as any)({
                  where,
                  skip,
                  take,
                  orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
                  select: {
                    id: true,
                    number: true,
                    title: true,
                    dueDate: true,
                    assignee: { select: assignee },
                  },
                })
              : [];
            return {
              total,
              items: records.map((r: any) => ({
                id: r.id,
                title: `${r.number} · ${r.title}`,
                reason:
                  r.dueDate && r.dueDate < start
                    ? 'Échéance dépassée'
                    : !r.assignee
                      ? 'Sans responsable'
                      : 'Action corrective en cours',
                action: 'Ouvrir le dossier',
                href:
                  k === 'support'
                    ? `/support?caseId=${encodeURIComponent(r.id)}`
                    : `/quality/nonconformities/${encodeURIComponent(r.id)}`,
                dueDate: day(r.dueDate),
                assignee: person(r.assignee),
              })),
            };
          }
          if (k === 'time') {
            // Independent approval: never suggest approving one's own time or authored entry.
            const predicate = Prisma.sql`t."tenantId" = ${tenantId} AND t.status = 'SUBMITTED' AND t."userId" <> ${actor.id} AND t."createdById" <> ${actor.id}
            AND (SELECT r."actorId" FROM service_time_reviews r WHERE r."tenantId" = ${tenantId} AND r."timeEntryId" = t.id AND r.action = 'CORRECT' ORDER BY r."entryVersion" DESC LIMIT 1) IS DISTINCT FROM ${actor.id}`;
            const count = await tx.$queryRaw<{ total: bigint }[]>(
              Prisma.sql`SELECT COUNT(*) AS total FROM service_time_entries t WHERE ${predicate}`,
            );
            const ids = rows
              ? await tx.$queryRaw<{ id: string }[]>(
                  Prisma.sql`SELECT t.id FROM service_time_entries t WHERE ${predicate} ORDER BY t."workDate", t.id OFFSET ${skip} LIMIT ${take}`,
                )
              : [];
            const total = Number(count[0].total);
            const records = ids.length
              ? await tx.serviceTimeEntry.findMany({
                  where: { tenantId, id: { in: ids.map((r) => r.id) } },
                  orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    workDate: true,
                    minutes: true,
                    user: { select: assignee },
                    job: { select: { number: true, projectId: true } },
                  },
                })
              : [];
            return {
              total,
              items: records.map((r) => ({
                id: r.id,
                title: `${r.job.number} · ${r.minutes} min`,
                reason: 'Temps soumis, décision indépendante requise',
                action: 'Réviser les heures',
                href: `/services/time?projectId=${encodeURIComponent(r.job.projectId)}`,
                dueDate: day(r.workDate),
                assignee: person(r.user),
              })),
            };
          }
          if (k === 'qualifications') {
            // A continuous renewal supersedes its predecessor; don't leave obsolete expiry alerts.
            const predicate = Prisma.sql`q."tenantId" = ${tenantId} AND q.status = 'ACTIVE' AND q."expiresOn" <= ${horizon}
            AND EXISTS (SELECT 1 FROM hr_employees e WHERE e.id = q."employeeId" AND e."tenantId" = ${tenantId} AND e.active = true ${mine ? Prisma.sql`AND e."userId" = ${actor.id}` : Prisma.empty})
            AND EXISTS (SELECT 1 FROM hr_skills s WHERE s.id = q."skillId" AND s."tenantId" = ${tenantId} AND s.active = true)
            AND NOT EXISTS (SELECT 1 FROM hr_qualifications r WHERE r."tenantId" = ${tenantId} AND r."employeeId" = q."employeeId" AND r."skillId" = q."skillId" AND r.status = 'ACTIVE' AND r.id <> q.id
              AND r."validFrom" <= GREATEST(${start}, q."expiresOn" + interval '1 day')
              AND (r."expiresOn" IS NULL OR r."expiresOn" > q."expiresOn" OR (r."expiresOn" = q."expiresOn" AND r.id > q.id)))`;
            const count = await tx.$queryRaw<{ total: bigint }[]>(
              Prisma.sql`SELECT COUNT(*) AS total FROM hr_qualifications q WHERE ${predicate}`,
            );
            const ids = rows
              ? await tx.$queryRaw<{ id: string }[]>(
                  Prisma.sql`SELECT q.id FROM hr_qualifications q WHERE ${predicate} ORDER BY q."expiresOn", q.id OFFSET ${skip} LIMIT ${take}`,
                )
              : [];
            const total = Number(count[0].total);
            const records = ids.length
              ? await tx.hrQualification.findMany({
                  where: { tenantId, id: { in: ids.map((r) => r.id) } },
                  orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    expiresOn: true,
                    employee: { select: { ...assignee, code: true } },
                    skill: { select: { name: true } },
                  },
                })
              : [];
            return {
              total,
              items: records.map((r) => ({
                id: r.id,
                title: `${person(r.employee)} · ${r.skill.name}`,
                reason:
                  r.expiresOn! < start
                    ? 'Habilitation expirée'
                    : `Expiration dans les ${config.settings.qualificationDays} prochains jours`,
                action: 'Vérifier le renouvellement',
                href: `/hr/qualifications?search=${encodeURIComponent(r.employee.code)}`,
                dueDate: day(r.expiresOn),
                assignee: person(r.employee),
              })),
            };
          }
          // SQL aggregation filters remaining quantities before pagination; no item-unit totals.
          // Mine does not invent an owner for supplier orders, which have no assignee yet.
          if (mine) return { total: 0, items: [] };
          const predicate = Prisma.sql`o."tenantId" = ${tenantId} AND o.status = 'CONFIRMED' AND EXISTS (
          SELECT 1 FROM supplier_order_lines l WHERE l."tenantId" = ${tenantId} AND l."orderId" = o.id
          AND l.quantity > COALESCE((SELECT SUM(rl.qty) FROM supplier_receipt_lines sl
          JOIN wms_receipt_lines rl ON rl.id = sl."receiptLineId" AND rl."tenantId" = ${tenantId}
          JOIN wms_receipts rc ON rc.id = rl."receiptId" AND rc."tenantId" = ${tenantId} AND rc.status = 'POSTED'
          WHERE sl."tenantId" = ${tenantId} AND sl."orderLineId" = l.id), 0))`;
          const count = await tx.$queryRaw<{ total: bigint }[]>(
            Prisma.sql`SELECT COUNT(*) AS total FROM supplier_orders o WHERE ${predicate}`,
          );
          const records = rows
            ? await tx.$queryRaw<{ id: string; number: string; expectedDate: Date | null }[]>(
                Prisma.sql`SELECT o.id, o.number, o."expectedDate" FROM supplier_orders o WHERE ${predicate} ORDER BY o."expectedDate" ASC NULLS LAST, o.id ASC OFFSET ${skip} LIMIT ${take}`,
              )
            : [];
          return {
            total: Number(count[0].total),
            items: records.map((r) => ({
              id: r.id,
              title: r.number,
              reason:
                r.expectedDate && r.expectedDate < start
                  ? 'Reliquat fournisseur en retard'
                  : 'Quantités encore attendues',
              action: 'Voir la commande et les réceptions',
              href: `/purchasing?orderId=${encodeURIComponent(r.id)}`,
              dueDate: day(r.expectedDate),
              assignee: null,
            })),
          };
        };
        const results = await Promise.all(
          kinds.map(async (k) => ({
            kind: k,
            label: ATTENTION_LABELS[k],
            ...(await source(k, k === kind)),
          })),
        );
        const selected = results.find((r) => r.kind === kind);
        return {
          kind,
          available: results.map(({ kind, label, total }) => ({ kind, label, total })),
          items: selected?.items ?? [],
          total: selected?.total ?? 0,
          page,
          pageSize,
          checkedAt: new Date().toISOString(),
          ...config,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
