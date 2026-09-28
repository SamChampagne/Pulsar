import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, StockMovementType, type ManufacturingMaterialSnapshot } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { InventoryService } from '../../wms/inventory/inventory.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { nextWmsVersion } from '../../wms/document-operations';
import { artifactHash } from '../scheduling/aps-artifact';
import { ProductionDeclarationDto } from './shop-floor.dto';
import { assertLot } from '../../wms/lots/lots.service';

function captureLot(lot: Awaited<ReturnType<typeof assertLot>>) {
  return lot
    ? {
        id: lot.id,
        code: lot.code,
        supplierLot: lot.supplierLot,
        manufacturedOn: lot.manufacturedOn?.toISOString().slice(0, 10) ?? null,
        expiresOn: lot.expiresOn?.toISOString().slice(0, 10) ?? null,
      }
    : null;
}

@Injectable()
export class ShopFloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditLogsService,
  ) {}
  private async gate(tenantId: string) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
  }
  async get(tenantId: string, orderId: string) {
    await this.gate(tenantId);
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { tenantId, id: orderId },
      include: {
        declarations: {
          where: { tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            reversal: { select: { id: true, reason: true, createdAt: true, evidence: true } },
          },
        },
        location: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException('OF introuvable.');
    const active = order.declarations.filter((d) => !d.reversal);
    const good = active.reduce((n, d) => n + d.goodQuantity, 0);
    const scrap = active.reduce((n, d) => n + d.scrapQuantity, 0);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      quantity: order.quantity,
      updatedAt: order.updatedAt,
      locationId: order.locationId,
      siteName: order.location?.name,
      materialSnapshot: order.materialSnapshot,
      good,
      scrap,
      remaining: order.quantity - good - scrap,
      declarations: order.declarations.map(
        ({ id, goodQuantity, scrapQuantity, note, evidence, createdAt, reversal }) => ({
          id,
          goodQuantity,
          scrapQuantity,
          note,
          evidence,
          createdAt,
          reversal,
        }),
      ),
    };
  }
  async declare(tenantId: string, userId: string, orderId: string, dto: ProductionDeclarationDto) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('manufacturingOrder', orderId, tenantId);
    await this.ownership.assertOwned('bin', dto.toBinId, tenantId);
    for (const line of dto.consumptions) {
      await this.ownership.assertOwned('wmsItem', line.itemId, tenantId);
      await this.ownership.assertOwned('bin', line.fromBinId, tenantId);
    }
    const fingerprint = artifactHash({ orderId, userId, ...dto });
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const replay = await tx.manufacturingDeclaration.findFirst({
          where: { tenantId, operationKey: dto.operationKey },
        });
        if (replay) {
          if (replay.fingerprint !== fingerprint)
            throw new ConflictException('Clé liée à une autre déclaration.');
          return { id: replay.id, replayed: true };
        }
        const order = await tx.manufacturingOrder.findFirstOrThrow({
          where: { tenantId, id: orderId },
          include: { declarations: { where: { tenantId, reversal: null } }, location: true },
        });
        if (order.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime())
          throw new ConflictException('OF modifié. Rechargez avant de déclarer.');
        if (order.status !== 'IN_PROGRESS')
          throw new ConflictException('Démarrez l’OF avant de déclarer la production.');
        const snapshot = order.materialSnapshot as unknown as ManufacturingMaterialSnapshot | null;
        if (
          !snapshot ||
          snapshot.version !== 'pulsar.manufacturing.materials.v1' ||
          snapshot.locationId !== order.locationId ||
          !order.location?.isActive ||
          order.location.type !== 'WAREHOUSE'
        )
          throw new ConflictException('Site et définition matières figés requis.');
        const declared = order.declarations.reduce(
          (n, d) => n + d.goodQuantity + d.scrapQuantity,
          0,
        );
        if (
          dto.goodQuantity + dto.scrapQuantity <= 0 ||
          declared + dto.goodQuantity + dto.scrapQuantity > order.quantity
        )
          throw new ConflictException(
            'La déclaration doit rester dans la quantité non encore déclarée.',
          );
        if (dto.note.trim().length < 3)
          throw new BadRequestException(
            'Note d’atelier requise, notamment pour expliquer les écarts et rebuts.',
          );
        const ids = new Set(snapshot.components.map((c) => c.itemId));
        if (
          dto.consumptions.some((c) => !ids.has(c.itemId)) ||
          [...ids].some((id) => !dto.consumptions.some((c) => c.itemId === id))
        )
          throw new BadRequestException(
            'Renseignez explicitement chaque composant de la version figée; aucun article supplémentaire.',
          );
        const items = await tx.wmsItem.findMany({
          where: { tenantId, id: { in: [snapshot.product.itemId, ...ids] }, isActive: true },
        });
        for (const captured of [snapshot.product, ...snapshot.components]) {
          const item = items.find((i) => i.id === captured.itemId);
          if (!item || item.unit !== captured.unit || item.sku !== captured.sku)
            throw new ConflictException('Article/unité incompatible avec la définition figée.');
        }
        const binIds = [...new Set([dto.toBinId, ...dto.consumptions.map((c) => c.fromBinId)])];
        if (
          (await tx.bin.count({
            where: { tenantId, id: { in: binIds }, locationId: order.locationId!, isActive: true },
          })) !== binIds.length
        )
          throw new ConflictException(
            'Tous les emplacements doivent être actifs et appartenir au site de l’OF.',
          );
        if (!dto.goodQuantity && dto.outputLotId)
          throw new BadRequestException(
            'Aucun lot produit sans quantité bonne. Le rebut ne crée pas de stock.',
          );
        const outputLot =
          dto.goodQuantity > 0
            ? captureLot(await assertLot(tx, tenantId, snapshot.product.itemId, dto.outputLotId))
            : null;
        const inputLots: ReturnType<typeof captureLot>[] = [];
        for (const line of dto.consumptions) {
          if (new Prisma.Decimal(line.quantity).isZero()) {
            if (line.lotId)
              throw new BadRequestException('Une consommation nulle ne porte pas de lot.');
            inputLots.push(null);
          } else inputLots.push(captureLot(await assertLot(tx, tenantId, line.itemId, line.lotId)));
        }
        const bins = await tx.bin.findMany({
          where: { tenantId, id: { in: binIds } },
          select: { id: true, code: true },
        });
        const declaration = await tx.manufacturingDeclaration.create({
          data: {
            tenantId,
            orderId,
            goodQuantity: dto.goodQuantity,
            scrapQuantity: dto.scrapQuantity,
            note: dto.note.trim(),
            evidence: {},
            operationKey: dto.operationKey,
            fingerprint,
            createdById: userId,
          },
        });
        const movements: {
          id: string;
          itemId: string;
          quantity: string;
          type: string;
          binId: string;
          unit: string;
          sku: string;
          name: string;
          binCode: string;
          lot: ReturnType<typeof captureLot>;
        }[] = [];
        // Actual consumption is explicit, never inferred/backflushed from theoretical BOM quantities.
        for (const [index, line] of dto.consumptions.entries()) {
          const qty = new Prisma.Decimal(line.quantity);
          if (qty.isZero()) continue;
          const movement = await this.inventory.postMovement(tx, {
            tenantId,
            userId,
            type: StockMovementType.CONSUMPTION,
            itemId: line.itemId,
            lotId: line.lotId,
            fromBinId: line.fromBinId,
            qty: qty.toNumber(),
            locationId: order.locationId!,
            refType: 'manufacturing-declaration',
            refId: declaration.id,
            note: `${order.number} · ${dto.note.trim()}`,
          });
          movements.push({
            id: movement.id,
            type: 'CONSUMPTION',
            itemId: line.itemId,
            quantity: qty.toFixed(),
            binId: line.fromBinId,
            unit: items.find((i) => i.id === line.itemId)!.unit,
            sku: items.find((i) => i.id === line.itemId)!.sku,
            name: items.find((i) => i.id === line.itemId)!.name,
            binCode: bins.find((b) => b.id === line.fromBinId)!.code,
            lot: inputLots[index],
          });
        }
        if (dto.goodQuantity > 0) {
          const movement = await this.inventory.postMovement(tx, {
            tenantId,
            userId,
            type: StockMovementType.PRODUCTION,
            itemId: snapshot.product.itemId,
            lotId: dto.outputLotId,
            toBinId: dto.toBinId,
            qty: dto.goodQuantity,
            locationId: order.locationId!,
            refType: 'manufacturing-declaration',
            refId: declaration.id,
            note: order.number,
          });
          movements.push({
            id: movement.id,
            type: 'PRODUCTION',
            itemId: snapshot.product.itemId,
            quantity: String(dto.goodQuantity),
            binId: dto.toBinId,
            unit: snapshot.product.unit,
            sku: snapshot.product.sku,
            name: snapshot.product.name,
            binCode: bins.find((b) => b.id === dto.toBinId)!.code,
            lot: outputLot,
          });
        }
        await tx.manufacturingDeclaration.update({
          where: { tenantId, id: declaration.id },
          data: {
            evidence: {
              version: 2,
              revisionId: snapshot.revisionId,
              locationId: snapshot.locationId,
              product: snapshot.product,
              consumptions: dto.consumptions.map((c, i) => ({
                ...c,
                unit: items.find((i) => i.id === c.itemId)!.unit,
                lot: inputLots[i],
              })),
              movements,
            },
          },
        });
        await tx.manufacturingOrder.update({
          where: { tenantId, id: orderId },
          data: { updatedAt: nextWmsVersion(order.updatedAt) },
        });
        return { id: declaration.id, replayed: false };
      },
      { timeout: 20000 },
    );
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId,
        entityType: 'manufacturing-declaration',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { orderId, goodQuantity: dto.goodQuantity, scrapQuantity: dto.scrapQuantity },
      });
    return result;
  }
}
