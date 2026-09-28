import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  type AuthUser,
  type LotTraceResult,
  type LotTraceNode,
  type LotTraceDossier,
  verifyLotTraceProof,
  lotTraceChronology,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { LotTraceQueryDto, LotTraceDossiersDto } from './lot-trace.dto';

const LIMITS = { nodes: 50, declarations: 80, edges: 160, states: 80 } as const;
@Injectable()
export class LotTraceService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}
  private async scopes(u: AuthUser) {
    const modules = await this.modules.getEnabledKeys(u.tenantId);
    return {
      manufacturing: modules.has('manufacturing') && u.permissions.includes('manufacturing.read'),
      services: modules.has('services') && u.permissions.includes('services.read'),
      transportation:
        modules.has('transportation') && u.permissions.includes('transportation.planning.read'),
    };
  }
  private async lot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lotId: string,
    itemId?: string,
  ) {
    const row = await tx.wmsLot.findFirst({
      where: { tenantId, id: lotId, ...(itemId ? { itemId } : {}) },
      select: {
        id: true,
        itemId: true,
        code: true,
        disposition: true,
        item: { select: { sku: true, name: true, unit: true } },
      },
    });
    if (!row) throw new NotFoundException('Lot introuvable dans cette entreprise.');
    return {
      id: row.id,
      itemId: row.itemId,
      code: row.code,
      disposition: row.disposition,
      ...row.item,
    };
  }
  async trace(
    u: AuthUser,
    itemId: string,
    lotId: string,
    q: LotTraceQueryDto,
  ): Promise<LotTraceResult> {
    const scopes = await this.scopes(u),
      tenantId = u.tenantId;
    return this.db.$transaction(
      async (tx) => {
        const nodes = new Map<string, LotTraceNode>([
          [lotId, { ...(await this.lot(tx, tenantId, lotId, itemId)), depth: 0 }],
        ]);
        const edges = new Map<string, LotTraceResult['edges'][number]>(),
          notices = new Map<string, LotTraceResult['notices'][number]>();
        let bounded = false;
        const warn = (
          key: string,
          code: string,
          message: string,
          extra: Partial<LotTraceResult['notices'][number]> = {},
        ) => {
          notices.set(key, { code, message, ...extra });
        };
        const bound = (key: string, message: string) => {
          bounded = true;
          warn(key, 'LIMIT', message);
        };
        const cache = new Map<string, Awaited<ReturnType<typeof this.declaration>>>();
        type State = { id: string; boundary: number; depth: number; path: string[] };
        const start = q.direction === 'downstream' ? -Infinity : Infinity;
        const queue: State[] = [{ id: lotId, boundary: start, depth: 0, path: [lotId] }];
        const visited = new Map<string, State[]>([[lotId, [queue[0]]]]);
        let states = 0;
        if (scopes.manufacturing)
          while (queue.length) {
            if (++states > LIMITS.states) {
              bound('states', 'Parcours borné : explorez un lot intermédiaire pour poursuivre.');
              break;
            }
            const s = queue.shift()!;
            if (s.depth >= q.depth) {
              bound(
                'depth',
                'Profondeur choisie atteinte : d’autres liens peuvent exister au-delà.',
              );
              continue;
            }
            const groups = await tx.stockMovement.groupBy({
              by: ['refId'],
              where: {
                tenantId,
                lotId: s.id,
                refType: 'manufacturing-declaration',
                refId: { not: null },
                type: q.direction === 'downstream' ? 'CONSUMPTION' : 'PRODUCTION',
                ...(Number.isFinite(s.boundary)
                  ? {
                      createdAt:
                        q.direction === 'downstream'
                          ? { gte: new Date(s.boundary) }
                          : { lte: new Date(s.boundary) },
                    }
                  : {}),
              },
              orderBy: { refId: 'asc' },
              take: LIMITS.declarations + 1,
            });
            if (groups.length > LIMITS.declarations)
              bound(
                'candidates',
                'Trop de déclarations pour cette vue : résultat partiel, consulter aussi le journal du lot.',
              );
            for (const group of groups.slice(0, LIMITS.declarations)) {
              const id = group.refId!;
              if (!cache.has(id)) {
                if (cache.size >= LIMITS.declarations) {
                  bound(
                    'declarations',
                    'Limite de déclarations examinées atteinte; résultat partiel.',
                  );
                  break;
                }
                cache.set(id, await this.declaration(tx, tenantId, id));
              }
              const d = cache.get(id)!;
              if (!d) {
                warn(
                  id,
                  'MISSING',
                  'Une référence atelier ne possède pas de déclaration vérifiable.',
                );
                continue;
              }
              const extra = { declarationId: id, order: d.order };
              if (d.reversed) {
                warn(
                  id,
                  'REVERSED',
                  'Déclaration contrepassée : conservée à l’historique, non suivie comme lien actif.',
                  extra,
                );
                continue;
              }
              if (!d.movements) {
                warn(
                  id,
                  'UNVERIFIED',
                  'Preuve historique ou incohérente : aucun lien matière-produit inventé.',
                  extra,
                );
                continue;
              }
              const ins = d.movements.filter((m) => m.type === 'CONSUMPTION'),
                out = d.movements.find((m) => m.type === 'PRODUCTION');
              if (!out || !out.lotId || !ins.length || ins.some((i) => !i.lotId))
                warn(
                  id,
                  'PARTIAL',
                  'Déclaration sans sortie tracée ou sans toutes ses matières tracées : chaîne incomplète.',
                  extra,
                );
              if (!out?.lotId) continue;
              for (const input of ins) {
                if (
                  !input.lotId ||
                  (q.direction === 'downstream' ? input.lotId !== s.id : out.lotId !== s.id)
                )
                  continue;
                if (!lotTraceChronology(q.direction, s.boundary, input.createdAt, out.createdAt)) {
                  warn(
                    `time:${id}`,
                    'CHRONOLOGY',
                    'Relation hors de la chronologie du chemin : non propagée.',
                    extra,
                  );
                  continue;
                }
                const nextId = q.direction === 'downstream' ? out.lotId : input.lotId,
                  edgeId = `${input.id}:${out.id}`;
                if (!edges.has(edgeId) && edges.size >= LIMITS.edges) {
                  bound('edges', 'Limite de liens atteinte : résultat partiel.');
                  continue;
                }
                if (!nodes.has(nextId)) {
                  if (nodes.size >= LIMITS.nodes) {
                    bound('nodes', 'Limite de lots atteinte : résultat partiel.');
                    continue;
                  }
                  nodes.set(nextId, {
                    ...(await this.lot(tx, tenantId, nextId)),
                    depth: s.depth + 1,
                  });
                }
                if (!edges.has(edgeId)) {
                  if (edges.size >= LIMITS.edges) {
                    bound('edges', 'Limite de liens atteinte : résultat partiel.');
                    continue;
                  }
                  edges.set(edgeId, {
                    id: edgeId,
                    fromLotId: input.lotId,
                    toLotId: out.lotId,
                    declarationId: id,
                    order: d.order,
                    createdAt: out.createdAt,
                    input: {
                      movementId: input.id,
                      quantity: input.quantity,
                      unit: input.unit!,
                      binCode: input.binCode,
                    },
                    output: {
                      movementId: out.id,
                      quantity: out.quantity,
                      unit: out.unit!,
                      binCode: out.binCode,
                    },
                  });
                }
                if (s.path.includes(nextId)) {
                  warn(
                    `cycle:${edgeId}`,
                    'CYCLE',
                    'Un lot réapparaît dans le chemin : lien affiché une fois, boucle non développée.',
                    extra,
                  );
                  continue;
                }
                const next: State = {
                  id: nextId,
                  depth: s.depth + 1,
                  boundary: Date.parse(
                    q.direction === 'downstream' ? out.createdAt : input.createdAt,
                  ),
                  path: [...s.path, nextId],
                };
                const previous = visited.get(nextId) ?? [];
                if (
                  previous.some(
                    (p) =>
                      p.depth <= next.depth &&
                      (q.direction === 'downstream'
                        ? p.boundary <= next.boundary
                        : p.boundary >= next.boundary),
                  )
                )
                  continue;
                visited.set(nextId, [...previous, next]);
                queue.push(next);
              }
            }
          }
        return {
          generatedAt: new Date().toISOString(),
          rootId: lotId,
          direction: q.direction,
          depth: q.depth,
          scopes,
          nodes: [...nodes.values()],
          edges: [...edges.values()],
          notices: [...notices.values()],
          bounded,
          limits: LIMITS,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
  private async declaration(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const d = await tx.manufacturingDeclaration.findFirst({
      where: { tenantId, id, order: { tenantId } },
      select: {
        evidence: true,
        order: { select: { id: true, number: true, locationId: true } },
        reversal: { where: { tenantId }, select: { id: true } },
      },
    });
    if (!d) return null;
    const rows = await tx.stockMovement.findMany({
      where: { tenantId, refType: 'manufacturing-declaration', refId: id },
      take: 202,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        type: true,
        itemId: true,
        lotId: true,
        lot: { select: { code: true } },
        fromBinId: true,
        toBinId: true,
        qty: true,
        unitSnapshot: true,
        createdAt: true,
        fromBin: { select: { tenantId: true, locationId: true } },
        toBin: { select: { tenantId: true, locationId: true } },
      },
    });
    const ownership = rows.every((r) =>
      [r.fromBin, r.toBin].every(
        (b) => !b || (b.tenantId === tenantId && b.locationId === d.order.locationId),
      ),
    );
    const movements = ownership
      ? verifyLotTraceProof(
          d.evidence,
          d.order.locationId,
          rows.map((r) => ({
            id: r.id,
            type: r.type,
            itemId: r.itemId,
            lotId: r.lotId,
            lotCode: r.lot?.code ?? null,
            fromBinId: r.fromBinId,
            toBinId: r.toBinId,
            quantity: r.qty.toFixed(),
            unit: r.unitSnapshot,
            createdAt: r.createdAt.toISOString(),
          })),
        )
      : null;
    return { order: { id: d.order.id, number: d.order.number }, reversed: !!d.reversal, movements };
  }
  async dossiers(u: AuthUser, itemId: string, lotId: string, q: LotTraceDossiersDto) {
    const scopes = await this.scopes(u),
      tenantId = u.tenantId;
    if (q.kind === 'services' && !scopes.services)
      throw new ForbiddenException('Services activé et services.read requis.');
    const { page, pageSize, skip, take } = paginationArgs(q);
    return this.db.$transaction(
      async (tx) => {
        const lot = await this.lot(tx, tenantId, lotId, itemId);
        let items: LotTraceDossier[], total: number;
        if (q.kind === 'services') {
          const where = {
            tenantId,
            lotId,
            wmsItemId: itemId,
            job: { tenantId, project: { tenantId } },
          };
          const rows = await tx.servicePartUsage.findMany({
            where,
            skip,
            take,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            select: {
              id: true,
              quantity: true,
              returnedQuantity: true,
              unitSnapshot: true,
              createdAt: true,
              job: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  status: true,
                  project: {
                    select: { id: true, number: true, partner: { select: { name: true } } },
                  },
                },
              },
            },
          });
          total = await tx.servicePartUsage.count({ where });
          items = rows.map((r) => ({
            id: r.id,
            number: r.job.number,
            title: r.job.title,
            status: r.job.status,
            href: `/services/interventions?jobId=${r.job.id}&section=parts`,
            createdAt: r.createdAt.toISOString(),
            quantity: r.quantity.toFixed(),
            returnedQuantity: r.returnedQuantity.toFixed(),
            retainedQuantity: r.quantity.minus(r.returnedQuantity).toFixed(),
            unit: r.unitSnapshot,
            unitCaptured: true,
            context: {
              label: r.job.project.number,
              href: `/services/projects/${r.job.project.id}`,
            },
            client: r.job.project.partner.name,
          }));
        } else {
          // One row per recorded line, never sum quantities across documents, lots or units.
          const predicate = { tenantId, itemId, lotId };
          if (q.kind === 'picks') {
            const where = { ...predicate, pickOrder: { tenantId } };
            const rows = await tx.pickLine.findMany({
              where,
              skip,
              take,
              orderBy: { id: 'asc' },
              select: {
                id: true,
                qty: true,
                pickOrder: {
                  select: {
                    id: true,
                    number: true,
                    status: true,
                    createdAt: true,
                    shipmentId: true,
                  },
                },
              },
            });
            total = await tx.pickLine.count({ where });
            const shipments = scopes.transportation
              ? await tx.shipment.findMany({
                  where: {
                    tenantId,
                    id: {
                      in: rows
                        .map((r) => r.pickOrder.shipmentId)
                        .filter((id): id is string => !!id),
                    },
                  },
                  select: { id: true, shipmentNumber: true },
                })
              : [];
            const index = new Map(shipments.map((s) => [s.id, s]));
            items = rows.map((r) => {
              const s = index.get(r.pickOrder.shipmentId ?? '');
              return {
                id: r.id,
                number: r.pickOrder.number,
                title: 'Ligne de préparation',
                status: r.pickOrder.status,
                href: `/wms/picking/${r.pickOrder.id}`,
                createdAt: r.pickOrder.createdAt.toISOString(),
                quantity: r.qty.toFixed(),
                unit: lot.unit,
                unitCaptured: false,
                ...(s
                  ? { context: { label: s.shipmentNumber, href: `/shipments?shipment=${s.id}` } }
                  : {}),
              };
            });
          } else {
            const where = { ...predicate, receipt: { tenantId } };
            const rows = await tx.receiptLine.findMany({
              where,
              skip,
              take,
              orderBy: { id: 'asc' },
              select: {
                id: true,
                qty: true,
                receipt: { select: { id: true, number: true, status: true, createdAt: true } },
              },
            });
            total = await tx.receiptLine.count({ where });
            items = rows.map((r) => ({
              id: r.id,
              number: r.receipt.number,
              title: 'Ligne de réception',
              status: r.receipt.status,
              href: `/wms/receiving/${r.receipt.id}`,
              createdAt: r.receipt.createdAt.toISOString(),
              quantity: r.qty.toFixed(),
              unit: lot.unit,
              unitCaptured: false,
            }));
          }
        }
        return {
          ...paginated(items, total, page, pageSize),
          generatedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
