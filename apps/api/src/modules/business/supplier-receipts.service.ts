import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { AuditAction, packageQuantity, type CatalogPackageSnapshot } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { ReceivingService } from '../wms/receiving/receiving.service';
import { assertWmsLine } from '../wms/document-operations';
import { assertLot } from '../wms/lots/lots.service';
import { lockBusinessTenant, nextBusinessVersion } from './business-lock';
import { BusinessQueryDto, CreateSupplierReceiptDto } from './business.dto';
import { paginationArgs, paginated } from '../../common/pagination';

export const supplierReceiptLines = {
  catalogItem: { select: { kind: true } },
  receipts: { select: { receiptLine: { select: { qty: true, itemId: true } } } },
} as const;
export function receiptProgress(line: {
  quantity: Prisma.Decimal;
  catalogItem: { kind: string };
  receipts: { receiptLine: { qty: Prisma.Decimal } }[];
}) {
  const received = line.receipts.reduce((n, r) => n.plus(r.receiptLine.qty), new Prisma.Decimal(0));
  return {
    stockItem: line.catalogItem.kind === 'GOODS',
    received: received.toString(),
    remaining: Prisma.Decimal.max(0, line.quantity.minus(received)).toString(),
  };
}

@Injectable()
export class SupplierReceiptsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly moduleRef: ModuleRef,
  ) {}
  private async requireWms(tenantId: string) {
    if (!(await this.modules.getEnabledKeys(tenantId)).has('wms'))
      throw new ForbiddenException('Activez Entrepôt pour réceptionner le stock.');
  }
  async list(tenantId: string, orderId: string, q: BusinessQueryDto) {
    if (
      !(await this.db.supplierOrder.findFirst({
        where: { tenantId, id: orderId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Commande introuvable.');
    // Only purchase-owned proof, not current stock or warehouse permissions.
    const { page, pageSize, skip, take } = paginationArgs(q);
    const [items, total] = await this.db.$transaction([
      this.db.supplierReceipt.findMany({
        where: { tenantId, orderId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          createdAt: true,
          receipt: { select: { id: true, number: true, reference: true, postedAt: true } },
          lines: {
            select: {
              orderLineId: true,
              unitSnapshot: true,
              packageCount: true,
              receiptLine: {
                select: { qty: true, lot: { select: { code: true, expiresOn: true } } },
              },
              // Lot identity belongs to the posted line; it is never inferred from packaging.
            },
          },
        },
      }),
      this.db.supplierReceipt.count({ where: { tenantId, orderId } }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async create(tenantId: string, userId: string, orderId: string, dto: CreateSupplierReceiptDto) {
    await this.requireWms(tenantId);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          userId,
          orderId,
          dto.expectedUpdatedAt,
          dto.locationId,
          dto.reference,
          dto.lines.map((l) => [
            l.orderLineId,
            l.binId,
            new Prisma.Decimal(l.quantity).toString(),
            ...(l.lotId ? [{ lotId: l.lotId }] : []),
            ...(l.packageCount !== undefined
              ? [{ packageCount: new Prisma.Decimal(l.packageCount).toString() }]
              : []),
          ]),
          ...(dto.customData
            ? [
                Object.keys(dto.customData)
                  .sort()
                  .map((k) => [k, dto.customData![k]]),
              ]
            : []),
        ]),
      )
      .digest('hex');
    // Resolve the existing WMS writer without importing the WMS module and its dependency graph.
    const receiving = this.moduleRef.get(ReceivingService, { strict: false });
    const result = await this.db.$transaction(
      async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const previous = await tx.supplierReceipt.findFirst({
          where: { tenantId, operationKey: dto.operationKey },
        });
        if (previous) {
          if (previous.requestFingerprint !== fingerprint)
            throw new ConflictException('Cette clé désigne une autre réception.');
          return { receiptId: previous.receiptId, replayed: true, posted: null };
        }
        const order = await tx.supplierOrder.findFirst({
          where: { tenantId, id: orderId },
          include: { lines: { include: supplierReceiptLines } },
        });
        if (!order) throw new NotFoundException('Commande introuvable.');
        const updatedAt = nextBusinessVersion(order, dto.expectedUpdatedAt);
        if (order.status !== 'CONFIRMED')
          throw new ConflictException(
            'Réception possible uniquement sur une commande confirmée et ouverte.',
          );
        await this.ownership.assertOwned('location', dto.locationId, tenantId, tx);
        const requested = new Map<string, Prisma.Decimal>();
        const resolved: {
          orderLineId: string;
          itemId: string;
          toBinId: string;
          qty: number;
          unit: string;
          packageCount?: string;
          lotId?: string;
        }[] = [];
        for (const input of dto.lines) {
          const line = order.lines.find((l) => l.id === input.orderLineId);
          if (!line) throw new NotFoundException('Ligne absente de cette commande.');
          if (input.packageCount !== undefined) {
            const pack = line.packageSnapshot as unknown as CatalogPackageSnapshot | null;
            if (!pack || pack.baseUnit !== line.unitSnapshot)
              throw new BadRequestException(
                'Aucun conditionnement compatible capturé sur cette ligne.',
              );
            let baseQuantity: string;
            try {
              baseQuantity = packageQuantity(
                input.packageCount,
                pack.unitsPerPackage,
                pack.wholeOnly,
                3,
              );
            } catch (e) {
              throw new BadRequestException((e as Error).message);
            }
            if (!new Prisma.Decimal(baseQuantity).eq(input.quantity))
              throw new BadRequestException(
                'La quantité de stock ne correspond pas aux conditionnements reçus.',
              );
          }
          const link = await tx.catalogStockLink.findFirst({
            where: { tenantId, catalogItemId: line.catalogItemId },
            include: { wmsItem: true, catalogItem: true },
          });
          if (
            !link ||
            !link.catalogItem.active ||
            link.catalogItem.kind !== 'GOODS' ||
            line.unitSnapshot !== link.wmsItem.unit
          )
            throw new ConflictException(
              'Reliez chaque produit actif à un article WMS de la même unité que la commande. Les prestations ne se réceptionnent pas en stock.',
            );
          if (line.receipts.some((r) => r.receiptLine.itemId !== link.wmsItemId))
            throw new ConflictException(
              'Cette ligne a déjà été reçue sur un autre article WMS. Rétablissez la correspondance avant de continuer.',
            );
          const qty = (requested.get(line.id) ?? new Prisma.Decimal(0)).plus(input.quantity);
          requested.set(line.id, qty);
          if (qty.gt(receiptProgress(line).remaining))
            throw new ConflictException(
              'Quantité supérieure au reste à recevoir. Vérifiez les autres arrivages.',
            );
          await this.ownership.assertOwned('bin', input.binId, tenantId, tx);
          await assertWmsLine(
            tx,
            tenantId,
            dto.locationId,
            link.wmsItemId,
            input.binId,
            input.quantity,
          );
          await assertLot(tx, tenantId, link.wmsItemId, input.lotId);
          resolved.push({
            orderLineId: line.id,
            itemId: link.wmsItemId,
            toBinId: input.binId,
            qty: input.quantity,
            unit: line.unitSnapshot,
            lotId: input.lotId,
            ...(input.packageCount !== undefined ? { packageCount: input.packageCount } : {}),
          });
        }
        // Numbering may leave a gap after rollback; stock, documents and allocations stay atomic.
        const customData = await receiving.validateCreateFields(tenantId, dto.customData);
        const number = await this.sequences.nextNumber(tenantId, 'receipt');
        const receipt = await tx.receipt.create({
          data: {
            tenantId,
            number,
            locationId: dto.locationId,
            reference: dto.reference,
            note: `Commande ${order.number}`,
            createdById: userId,
            ...(customData !== undefined
              ? { customData: customData as Prisma.InputJsonValue }
              : {}),
          },
        });
        const allocation = await tx.supplierReceipt.create({
          data: {
            tenantId,
            orderId,
            receiptId: receipt.id,
            operationKey: dto.operationKey,
            requestFingerprint: fingerprint,
          },
        });
        for (const line of resolved) {
          const rl = await tx.receiptLine.create({
            data: {
              tenantId,
              receiptId: receipt.id,
              itemId: line.itemId,
              toBinId: line.toBinId,
              qty: line.qty,
              lotId: line.lotId,
            },
          });
          await tx.supplierReceiptLine.create({
            data: {
              tenantId,
              supplierReceiptId: allocation.id,
              orderLineId: line.orderLineId,
              receiptLineId: rl.id,
              unitSnapshot: line.unit,
              ...(line.packageCount !== undefined ? { packageCount: line.packageCount } : {}),
            },
          });
        }
        const posted = await receiving.postInTransaction(tx, tenantId, userId, receipt.id);
        await tx.supplierOrder.updateMany({
          where: { tenantId, id: orderId, updatedAt: order.updatedAt },
          data: { updatedAt },
        });
        return { receiptId: receipt.id, replayed: false, posted };
      },
      { timeout: 15000 },
    );
    if (result.posted) {
      await receiving.afterPost(tenantId, userId, result.posted);
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'supplier-receipt',
        entityId: result.receiptId,
        after: { orderId, reference: dto.reference, lines: dto.lines },
      });
    }
    return { receiptId: result.receiptId, replayed: result.replayed };
  }
}
