import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { deriveMaterialImpact, type ManufacturingMaterialSnapshot } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { materialArrivals } from './material-arrivals';

@Injectable()
export class MaterialImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}
  async get(tenantId: string, locationId: string) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
    return this.prisma.$transaction(
      async (tx) => {
        const site = await tx.location.findFirst({
          where: { tenantId, id: locationId, type: 'WAREHOUSE', isActive: true },
          select: { id: true, name: true },
        });
        if (!site)
          throw new BadRequestException('Choisissez un entrepôt actif de cette entreprise.');
        const orders = await tx.manufacturingOrder.findMany({
          where: { tenantId, locationId, status: { in: ['RELEASED', 'IN_PROGRESS'] } },
          include: { declarations: { where: { tenantId }, orderBy: { id: 'asc' } } },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: 2001,
        });
        if (orders.length > 2000)
          throw new BadRequestException('Maximum 2 000 OF actifs par site.');
        const stocks = await tx.inventoryLevel.groupBy({
          by: ['itemId'],
          where: {
            tenantId,
            bin: { tenantId, locationId, isActive: true },
            item: { tenantId, isActive: true },
          },
          _sum: { qtyOnHand: true },
        });
        const arrivals = await materialArrivals(tx, tenantId, locationId);
        const baseline = await tx.schedulingRun.findFirst({
          where: { tenantId, isBaseline: true },
          select: {
            id: true,
            assignments: { where: { tenantId }, select: { orderId: true, start: true } },
          },
        });
        const today = new Date().toISOString().slice(0, 10);
        const items = await tx.wmsItem.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, sku: true, unit: true },
        });
        const itemById = new Map(items.map((item) => [item.id, item]));
        const unassessedOrders: { id: string; number: string; reason: string }[] = [];
        const eligible = orders.filter((o) => {
          const snapshot = o.materialSnapshot as unknown as ManufacturingMaterialSnapshot | null;
          if (
            !snapshot ||
            snapshot.version !== 'pulsar.manufacturing.materials.v1' ||
            snapshot.locationId !== locationId ||
            !Array.isArray(snapshot.components)
          ) {
            unassessedOrders.push({
              id: o.id,
              number: o.number,
              reason: 'Définition matières figée absente ou incompatible.',
            });
            return false;
          }
          if (
            [snapshot.product, ...snapshot.components].some((c) => {
              const item = itemById.get(c.itemId);
              return !item || item.unit !== c.unit || item.sku !== c.sku;
            })
          ) {
            unassessedOrders.push({
              id: o.id,
              number: o.number,
              reason: 'Article inactif ou différent de sa définition figée.',
            });
            return false;
          }
          return true;
        });
        const impacts = deriveMaterialImpact({
          today,
          stocks: stocks.map((s) => ({
            itemId: s.itemId,
            quantity: (s._sum.qtyOnHand ?? new Prisma.Decimal(0)).toFixed(),
          })),
          arrivals,
          orders: eligible.map((o) => {
            const snapshot = o.materialSnapshot as unknown as ManufacturingMaterialSnapshot;
            const fullyDeclared =
              o.declarations.reduce((n, d) => n + d.goodQuantity + d.scrapQuantity, 0) >=
              o.quantity;
            const planned = baseline?.assignments
              .filter((a) => a.orderId === o.id)
              .map((a) => a.start.toISOString().slice(0, 10))
              .sort()[0];
            return {
              id: o.id,
              dueDate: o.dueDate.toISOString(),
              targetDate: planned ?? o.releaseDate.toISOString().slice(0, 10),
              components: snapshot.components.map((c) => {
                const consumed = o.declarations
                  .flatMap((d) => (d.evidence as any)?.consumptions ?? [])
                  .filter((l: any) => l.itemId === c.itemId)
                  .reduce((n: Prisma.Decimal, l: any) => n.plus(l.quantity), new Prisma.Decimal(0));
                return {
                  itemId: c.itemId,
                  quantity: fullyDeclared
                    ? '0'
                    : Prisma.Decimal.max(
                        0,
                        new Prisma.Decimal(c.requiredQuantity).minus(consumed),
                      ).toFixed(),
                };
              }),
            };
          }),
        });
        return {
          site,
          asOf: today,
          baselineId: baseline?.id ?? null,
          arrivals,
          orders: impacts.map((impact) => {
            const o = eligible.find((o) => o.id === impact.id)!;
            const snapshot = o.materialSnapshot as unknown as ManufacturingMaterialSnapshot;
            return {
              ...impact,
              number: o.number,
              name: o.name,
              status: o.status,
              dueDate: o.dueDate,
              hasActuals: o.declarations.length > 0,
              components: impact.components.map((c) => ({
                ...c,
                sku: snapshot.components.find((l) => l.itemId === c.itemId)!.sku,
                name: snapshot.components.find((l) => l.itemId === c.itemId)!.name,
                unit: snapshot.components.find((l) => l.itemId === c.itemId)!.unit,
              })),
            };
          }),
          unassessedOrders,
          guidance:
            'Simulation consultative par date d’échéance puis identifiant. Le stock partagé est alloué une seule fois dans cette vue, sans réservation. Les promesses déjà en retard sont exclues. Les besoins des OF non évalués ne sont pas déduits : aucune disponibilité globale ne peut alors être garantie. La capacité et les dates finales exigent un nouveau scénario APS; aucune publication automatique.',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
}
