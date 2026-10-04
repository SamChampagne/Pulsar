import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  deriveDeliveryAllocationQuantities,
  normalizeDeliveryPackageQuantity,
  validateDeliveryPackageContents,
  type AuthUser,
  type DeliveryAllocationWorkspace,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { lockBusinessTenant } from '../../business/business-lock';
import {
  CreateDeliveryAllocationDto,
  ReleaseDeliveryAllocationDto,
} from './delivery-allocation.dto';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const next = (value: Date) => new Date(Math.max(Date.now(), value.getTime() + 1));
const iso = (value: Date) => value.toISOString();
function sourceQuantity(value: string) {
  try {
    return normalizeDeliveryPackageQuantity(value);
  } catch {
    throw new BadRequestException(
      'Quantité source non représentable : valeur positive, 12 chiffres entiers et 3 décimales maximum.',
    );
  }
}
type Tx = Prisma.TransactionClient;
type Access = { sales: boolean; picking: boolean };
const packageSelect = {
  id: true,
  code: true,
  shipmentId: true,
  status: true,
  version: true,
  contents: true,
} as const;

@Injectable()
export class DeliveryAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}

  private async access(user: AuthUser): Promise<Access> {
    const enabled = await this.modules.getEnabledKeys(user.tenantId);
    return {
      sales: enabled.has('crm') && user.permissions.includes('crm.read'),
      picking: enabled.has('wms') && user.permissions.includes('wms.read'),
    };
  }
  private requireSources(access: Access, sales: unknown, pick: unknown) {
    if (sales && !access.sales)
      throw new ForbiddenException('CRM activé et droit crm.read requis pour cette attribution.');
    if (pick && !access.picking)
      throw new ForbiddenException(
        'Entrepôt activé et droit wms.read requis pour cette attribution.',
      );
  }
  private async operation(tx: Tx, user: AuthUser, key: string, body: unknown) {
    const operationKey = key.toLowerCase();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-allocation:${user.tenantId}:${operationKey}`}, 0))`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ actorId: user.id, body }))
      .digest('hex');
    const previous = await tx.deliveryAllocationOperation.findUnique({
      where: { tenantId_operationKey: { tenantId: user.tenantId, operationKey } },
    });
    if (previous && (previous.fingerprint !== fingerprint || previous.actorId !== user.id))
      throw new ConflictException('Cette clé a déjà été utilisée pour une autre demande.');
    return { operationKey, fingerprint, result: previous?.result };
  }
  private async context(tx: Tx, tenantId: string, packageId: string) {
    // Global capacity/source locks FIRST; never acquire them after a Load lock.
    await lockBusinessTenant(tx, tenantId);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const initial = await tx.deliveryPackage.findFirst({
      where: { tenantId, id: packageId },
      select: { shipmentId: true },
    });
    if (!initial) throw new NotFoundException('Colis introuvable.');
    const initialShipment = await tx.shipment.findFirstOrThrow({
      where: { tenantId, id: initial.shipmentId },
      select: { loadId: true },
    });
    if (initialShipment.loadId)
      await tx.$queryRaw`SELECT id FROM loads WHERE "tenantId" = ${tenantId} AND id = ${initialShipment.loadId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM shipments WHERE "tenantId" = ${tenantId} AND id = ${initial.shipmentId} FOR UPDATE`;
    const shipment = await tx.shipment.findFirstOrThrow({
      where: { tenantId, id: initial.shipmentId },
    });
    if (shipment.loadId !== initialShipment.loadId)
      throw new ConflictException('Expédition réaffectée. Rechargez.');
    const load = shipment.loadId
      ? await tx.load.findFirstOrThrow({ where: { tenantId, id: shipment.loadId } })
      : null;
    const pkg = await tx.deliveryPackage.findFirstOrThrow({
      where: { tenantId, id: packageId },
      select: packageSelect,
    });
    return { shipment, load, pkg };
  }
  private async beforeEngagement(
    tx: Tx,
    tenantId: string,
    context: Awaited<ReturnType<DeliveryAllocationService['context']>>,
    version: number,
  ) {
    const { pkg, shipment, load } = context;
    if (pkg.version !== version)
      throw new ConflictException('Le colis a changé. Rechargez avant confirmation.');
    if (
      pkg.status !== 'PREPARED' ||
      !['PENDING', 'PLANNED'].includes(shipment.status) ||
      (load && !['OPEN', 'PLANNED'].includes(load.status))
    )
      throw new ConflictException(
        'Attribution modifiable seulement avant engagement de la livraison.',
      );
    if (
      await tx.deliveryPackageEvent.findFirst({
        where: { tenantId, packageId: pkg.id, kind: 'LOADED' },
        select: { id: true },
      })
    )
      throw new ConflictException(
        'Ce colis a déjà été chargé : son attribution source est historique et ne peut plus changer.',
      );
  }
  private async touch(
    tx: Tx,
    tenantId: string,
    context: Awaited<ReturnType<DeliveryAllocationService['context']>>,
  ) {
    const changed = await tx.deliveryPackage.updateMany({
      where: { tenantId, id: context.pkg.id, version: context.pkg.version },
      data: { version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ConflictException('Le colis a changé pendant la confirmation. Rechargez.');
    await tx.shipment.updateMany({
      where: { tenantId, id: context.shipment.id },
      data: { updatedAt: next(context.shipment.updatedAt) },
    });
    if (context.load)
      await tx.load.updateMany({
        where: { tenantId, id: context.load.id },
        data: { updatedAt: next(context.load.updatedAt) },
      });
  }
  private async record(
    tx: Tx,
    user: AuthUser,
    allocationId: string,
    packageId: string,
    version: number,
    released: boolean,
    operation: { operationKey: string; fingerprint: string },
  ) {
    const result = {
      operationKey: operation.operationKey,
      allocationId,
      packageId,
      version,
      released,
    };
    await tx.deliveryAllocationOperation.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        allocationId,
        operationKey: operation.operationKey,
        fingerprint: operation.fingerprint,
        result: json(result),
      },
    });
    await this.audit.log(
      {
        tenantId: user.tenantId,
        userId: user.id,
        action: AuditAction.UPDATE,
        entityType: 'delivery-content-allocation',
        entityId: allocationId,
        after: { packageId, released, operationKey: operation.operationKey },
      },
      tx,
    );
    return result;
  }
  private async enforceCapacity(
    tx: Tx,
    tenantId: string,
    source: 'sourceSalesOrderLineId' | 'sourcePickLineId',
    id: string,
    quantity: string,
    unit: string,
    candidate: string,
  ) {
    const active = await tx.deliveryContentAllocation.findMany({
      where: { tenantId, [source]: id, releasedAt: null },
      select: { quantity: true, unit: true, package: { select: { status: true } } },
      take: 10001,
    });
    if (active.length > 10000)
      throw new ConflictException(
        'Trop d’attributions pour cette source; demandez une revue à l’exploitation.',
      );
    try {
      deriveDeliveryAllocationQuantities(quantity, unit, [
        ...active.map((row) => ({
          quantity: row.quantity.toFixed(),
          unit: row.unit,
          packageStatus: row.package.status,
          released: false,
        })),
        { quantity: candidate, unit, packageStatus: 'PREPARED', released: false },
      ]);
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : 'Quantité source incompatible.',
      );
    }
  }

  async create(user: AuthUser, dto: CreateDeliveryAllocationDto) {
    const access = await this.access(user);
    this.requireSources(access, dto.sourceSalesOrderLineId, dto.sourcePickLineId);
    if (!dto.sourceSalesOrderLineId && !dto.sourcePickLineId)
      throw new BadRequestException('Choisissez une ligne de commande ou de préparation.');
    const body = {
      kind: 'CREATE',
      packageId: dto.packageId,
      contentIndex: dto.contentIndex,
      expectedVersion: dto.expectedVersion,
      sourceSalesOrderLineId: dto.sourceSalesOrderLineId ?? null,
      sourcePickLineId: dto.sourcePickLineId ?? null,
      salesUnitAcknowledged: dto.salesUnitAcknowledged ?? false,
      expectedSalesLineUpdatedAt: dto.expectedSalesLineUpdatedAt ?? null,
      expectedSalesOrderUpdatedAt: dto.expectedSalesOrderUpdatedAt ?? null,
      expectedPickUpdatedAt: dto.expectedPickUpdatedAt ?? null,
    };
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.operation(tx, user, dto.operationKey, body);
      if (operation.result) return operation.result;
      const context = await this.context(tx, user.tenantId, dto.packageId);
      await this.beforeEngagement(tx, user.tenantId, context, dto.expectedVersion);
      const contents = validateDeliveryPackageContents(context.pkg.contents);
      const content = contents[dto.contentIndex];
      if (!content) throw new BadRequestException('Ligne de contenu inexistante.');
      if (
        await tx.deliveryContentAllocation.findFirst({
          where: {
            tenantId: user.tenantId,
            packageId: dto.packageId,
            contentIndex: dto.contentIndex,
            releasedAt: null,
          },
          select: { id: true },
        })
      )
        throw new ConflictException(
          'Cette ligne est déjà attribuée. Libérez son lien avant de le remplacer.',
        );
      const snapshot: Record<string, unknown> = {
        schemaVersion: 1,
        siteId: context.shipment.originLocationId,
      };
      if (dto.sourceSalesOrderLineId) {
        if (dto.salesUnitAcknowledged !== true)
          throw new BadRequestException(
            'Confirmez explicitement : une unité commerciale correspond à une unité du contenu.',
          );
        const actor = await tx.user.findFirst({
          where: {
            tenantId: user.tenantId,
            id: user.id,
            status: 'ACTIVE',
            agentServiceFor: { none: {} },
            NOT: { email: 'service-account@pulsar.local' },
          },
          select: { id: true },
        });
        if (!actor)
          throw new ForbiddenException(
            'La correspondance commerciale doit être confirmée par un utilisateur humain actif.',
          );
        const order = await tx.transportOrder.findFirstOrThrow({
          where: { tenantId: user.tenantId, id: context.shipment.transportOrderId },
          select: { sourceSalesOrderId: true },
        });
        const line = await tx.salesOrderLineItem.findFirst({
          where: {
            tenantId: user.tenantId,
            id: dto.sourceSalesOrderLineId,
            salesOrderId: order.sourceSalesOrderId ?? '',
          },
          include: {
            salesOrder: {
              select: { tenantId: true, id: true, number: true, status: true, updatedAt: true },
            },
          },
        });
        if (
          !line ||
          line.salesOrder.tenantId !== user.tenantId ||
          line.salesOrder.status !== 'CONFIRMED'
        )
          throw new BadRequestException(
            'La ligne doit appartenir à la commande CRM confirmée à l’origine de cette expédition.',
          );
        if (
          iso(line.updatedAt) !== dto.expectedSalesLineUpdatedAt ||
          iso(line.salesOrder.updatedAt) !== dto.expectedSalesOrderUpdatedAt
        )
          throw new ConflictException('La source commerciale a changé. Rechargez.');
        const quantity = sourceQuantity(line.quantity.toFixed());
        await this.enforceCapacity(
          tx,
          user.tenantId,
          'sourceSalesOrderLineId',
          line.id,
          quantity,
          content.unit,
          content.quantity,
        );
        snapshot.sales = {
          id: line.id,
          salesOrderId: line.salesOrderId,
          number: line.salesOrder.number,
          name: line.name,
          quantity,
          unit: content.unit,
          unitBasis: 'HUMAN_ATTESTED_1_TO_1',
          acknowledgedById: user.id,
          lineUpdatedAt: iso(line.updatedAt),
          orderUpdatedAt: iso(line.salesOrder.updatedAt),
        };
      }
      if (dto.sourcePickLineId) {
        const line = await tx.pickLine.findFirst({
          where: {
            tenantId: user.tenantId,
            id: dto.sourcePickLineId,
            pickOrder: {
              tenantId: user.tenantId,
              shipmentId: context.shipment.id,
              locationId: context.shipment.originLocationId,
              status: 'COMPLETED',
            },
          },
          include: {
            pickOrder: {
              select: {
                id: true,
                number: true,
                locationId: true,
                updatedAt: true,
                completedAt: true,
              },
            },
            item: { select: { tenantId: true, id: true, sku: true, name: true, unit: true } },
          },
        });
        if (!line || line.item.tenantId !== user.tenantId)
          throw new BadRequestException(
            'Choisissez une préparation terminée, liée à cette expédition et à son entrepôt de départ.',
          );
        if (iso(line.pickOrder.updatedAt) !== dto.expectedPickUpdatedAt)
          throw new ConflictException('La préparation a changé. Rechargez.');
        if (line.item.unit !== content.unit)
          throw new BadRequestException(
            'L’unité du contenu doit être strictement identique à celle de la préparation, sans conversion.',
          );
        const quantity = sourceQuantity(line.qty.toFixed());
        await this.enforceCapacity(
          tx,
          user.tenantId,
          'sourcePickLineId',
          line.id,
          quantity,
          content.unit,
          content.quantity,
        );
        snapshot.pick = {
          id: line.id,
          pickOrderId: line.pickOrderId,
          number: line.pickOrder.number,
          itemId: line.itemId,
          sku: line.item.sku,
          name: line.item.name,
          quantity,
          unit: line.item.unit,
          locationId: line.pickOrder.locationId,
          fromBinId: line.fromBinId,
          lotId: line.lotId,
          completedAt: line.pickOrder.completedAt?.toISOString() ?? null,
          updatedAt: iso(line.pickOrder.updatedAt),
        };
      }
      const allocation = await tx.deliveryContentAllocation.create({
        data: {
          tenantId: user.tenantId,
          packageId: dto.packageId,
          contentIndex: dto.contentIndex,
          sourceSalesOrderLineId: dto.sourceSalesOrderLineId ?? null,
          sourcePickLineId: dto.sourcePickLineId ?? null,
          quantity: content.quantity,
          unit: content.unit,
          sourceSnapshot: json(snapshot),
          contentSnapshot: json(content),
          actorId: user.id,
        },
      });
      await this.touch(tx, user.tenantId, context);
      return this.record(
        tx,
        user,
        allocation.id,
        dto.packageId,
        context.pkg.version + 1,
        false,
        operation,
      );
    });
  }
  async release(user: AuthUser, id: string, dto: ReleaseDeliveryAllocationDto) {
    const access = await this.access(user);
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.operation(tx, user, dto.operationKey, {
        kind: 'RELEASE',
        id,
        expectedVersion: dto.expectedVersion,
      });
      const initial = await tx.deliveryContentAllocation.findFirst({
        where: { tenantId: user.tenantId, id },
        select: { packageId: true, sourceSalesOrderLineId: true, sourcePickLineId: true },
      });
      if (!initial) throw new NotFoundException('Attribution introuvable.');
      this.requireSources(access, initial.sourceSalesOrderLineId, initial.sourcePickLineId);
      if (operation.result) return operation.result;
      const context = await this.context(tx, user.tenantId, initial.packageId);
      await this.beforeEngagement(tx, user.tenantId, context, dto.expectedVersion);
      const changed = await tx.deliveryContentAllocation.updateMany({
        where: { tenantId: user.tenantId, id, releasedAt: null },
        data: { releasedAt: new Date(), releasedById: user.id },
      });
      if (changed.count !== 1) throw new ConflictException('Cette attribution a déjà été libérée.');
      await this.touch(tx, user.tenantId, context);
      return this.record(tx, user, id, initial.packageId, context.pkg.version + 1, true, operation);
    });
  }

  async list(user: AuthUser, shipmentId: string): Promise<DeliveryAllocationWorkspace> {
    const access = await this.access(user);
    return this.prisma.$transaction(
      async (tx) => {
        const shipment = await tx.shipment.findFirst({
          where: { tenantId: user.tenantId, id: shipmentId },
          include: {
            load: { select: { status: true } },
            transportOrder: { select: { sourceSalesOrderId: true } },
          },
        });
        if (!shipment) throw new NotFoundException('Expédition introuvable.');
        const packages = await tx.deliveryPackage.findMany({
          where: { tenantId: user.tenantId, shipmentId },
          select: packageSelect,
          orderBy: { createdAt: 'asc' },
          take: 201,
        });
        if (packages.length > 200)
          throw new BadRequestException('Maximum 200 colis pour ce poste.');
        const ids = packages.map((p) => p.id);
        const locked = await tx.deliveryContentAllocation.findMany({
          where: { tenantId: user.tenantId, packageId: { in: ids }, releasedAt: null },
          select: { packageId: true, contentIndex: true },
        });
        const engaged = await tx.deliveryPackageEvent.findMany({
          where: { tenantId: user.tenantId, packageId: { in: ids }, kind: 'LOADED' },
          select: { packageId: true },
          distinct: ['packageId'],
        });
        const engagedIds = new Set(engaged.map((event) => event.packageId));
        const editable =
          ['PENDING', 'PLANNED'].includes(shipment.status) &&
          (!shipment.load || ['OPEN', 'PLANNED'].includes(shipment.load.status));
        const allocations = await tx.deliveryContentAllocation.findMany({
          where: {
            tenantId: user.tenantId,
            packageId: { in: ids },
            ...(!access.sales ? { sourceSalesOrderLineId: null } : {}),
            ...(!access.picking ? { sourcePickLineId: null } : {}),
          },
          orderBy: { createdAt: 'asc' },
          take: 10001,
        });
        if (allocations.length > 10000)
          throw new BadRequestException('Historique trop volumineux pour ce poste.');
        const salesLines: DeliveryAllocationWorkspace['salesLines'] = [];
        const pickLines: DeliveryAllocationWorkspace['pickLines'] = [];
        if (access.sales && shipment.transportOrder.sourceSalesOrderId) {
          const rows = await tx.salesOrderLineItem.findMany({
            where: {
              tenantId: user.tenantId,
              salesOrderId: shipment.transportOrder.sourceSalesOrderId,
              salesOrder: { tenantId: user.tenantId },
            },
            include: { salesOrder: { select: { number: true, status: true, updatedAt: true } } },
            orderBy: { createdAt: 'asc' },
            take: 501,
          });
          if (rows.length > 500)
            throw new BadRequestException('Maximum 500 lignes commerciales pour ce poste.');
          const allLinks = await tx.deliveryContentAllocation.findMany({
            where: {
              tenantId: user.tenantId,
              sourceSalesOrderLineId: { in: rows.map((line) => line.id) },
              releasedAt: null,
            },
            select: {
              sourceSalesOrderLineId: true,
              quantity: true,
              unit: true,
              package: { select: { status: true } },
            },
            take: 10001,
          });
          if (allLinks.length > 10000)
            throw new BadRequestException('Historique source trop volumineux.');
          for (const line of rows) {
            const linked = allLinks.filter((link) => link.sourceSalesOrderLineId === line.id);
            const unit = linked[0]?.unit ?? null;
            salesLines.push({
              id: line.id,
              kind: 'sales',
              name: line.name,
              documentNumber: line.salesOrder.number,
              siteId: null,
              siteName: null,
              quantity: line.quantity.toFixed(),
              unit,
              updatedAt: iso(line.updatedAt),
              orderUpdatedAt: iso(line.salesOrder.updatedAt),
              status: line.salesOrder.status,
              selectable: line.salesOrder.status === 'CONFIRMED',
              totals: unit
                ? deriveDeliveryAllocationQuantities(
                    line.quantity.toFixed(),
                    unit,
                    linked.map((row) => ({
                      quantity: row.quantity.toFixed(),
                      unit: row.unit,
                      packageStatus: row.package.status,
                      released: false,
                    })),
                  )
                : null,
            });
          }
        }
        if (access.picking) {
          const rows = await tx.pickLine.findMany({
            where: {
              tenantId: user.tenantId,
              pickOrder: {
                tenantId: user.tenantId,
                shipmentId,
                locationId: shipment.originLocationId,
                status: 'COMPLETED',
              },
              item: { tenantId: user.tenantId },
            },
            include: {
              pickOrder: {
                select: {
                  number: true,
                  status: true,
                  updatedAt: true,
                  locationId: true,
                  location: { select: { name: true } },
                },
              },
              item: { select: { name: true, sku: true, unit: true } },
            },
            orderBy: { id: 'asc' },
            take: 501,
          });
          if (rows.length > 500)
            throw new BadRequestException('Maximum 500 lignes de préparation pour ce poste.');
          const allLinks = await tx.deliveryContentAllocation.findMany({
            where: {
              tenantId: user.tenantId,
              sourcePickLineId: { in: rows.map((line) => line.id) },
              releasedAt: null,
            },
            select: {
              sourcePickLineId: true,
              quantity: true,
              unit: true,
              package: { select: { status: true } },
            },
            take: 10001,
          });
          if (allLinks.length > 10000)
            throw new BadRequestException('Historique source trop volumineux.');
          for (const line of rows) {
            const linked = allLinks.filter((link) => link.sourcePickLineId === line.id);
            pickLines.push({
              id: line.id,
              kind: 'pick',
              name: `${line.item.sku} · ${line.item.name}`,
              documentNumber: line.pickOrder.number,
              siteId: line.pickOrder.locationId,
              siteName: line.pickOrder.location.name,
              quantity: line.qty.toFixed(),
              unit: line.item.unit,
              updatedAt: iso(line.pickOrder.updatedAt),
              status: line.pickOrder.status,
              selectable: true,
              totals: deriveDeliveryAllocationQuantities(
                line.qty.toFixed(),
                line.item.unit,
                linked.map((row) => ({
                  quantity: row.quantity.toFixed(),
                  unit: row.unit,
                  packageStatus: row.package.status,
                  released: false,
                })),
              ),
            });
          }
        }
        return {
          shipment: {
            id: shipment.id,
            shipmentNumber: shipment.shipmentNumber,
            status: shipment.status,
            updatedAt: iso(shipment.updatedAt),
          },
          access,
          salesLines,
          pickLines,
          packages: packages.map((pkg) => ({
            id: pkg.id,
            code: pkg.code,
            status: pkg.status,
            version: pkg.version,
            contents: validateDeliveryPackageContents(pkg.contents),
            canAllocate: editable && pkg.status === 'PREPARED' && !engagedIds.has(pkg.id),
            lockedContentIndices: locked
              .filter((link) => link.packageId === pkg.id)
              .map((link) => link.contentIndex),
          })),
          allocations: allocations.map((link) => {
            const snapshot = link.sourceSnapshot as {
              sales?: { number: string; name: string };
              pick?: { number: string; name: string };
            };
            return {
              id: link.id,
              packageId: link.packageId,
              contentIndex: link.contentIndex,
              quantity: link.quantity.toFixed(),
              unit: link.unit,
              sourceSalesOrderLineId: link.sourceSalesOrderLineId,
              sourcePickLineId: link.sourcePickLineId,
              salesLabel: snapshot.sales
                ? `${snapshot.sales.number} · ${snapshot.sales.name}`
                : null,
              pickLabel: snapshot.pick ? `${snapshot.pick.number} · ${snapshot.pick.name}` : null,
              createdAt: iso(link.createdAt),
              releasedAt: link.releasedAt?.toISOString() ?? null,
              canRelease:
                !link.releasedAt &&
                editable &&
                !engagedIds.has(link.packageId) &&
                packages.find((pkg) => pkg.id === link.packageId)?.status === 'PREPARED',
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
}
