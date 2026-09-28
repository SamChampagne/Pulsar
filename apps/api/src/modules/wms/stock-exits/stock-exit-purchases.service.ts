import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type WmsStockExit } from '@pulsar/database';
import { type AuthUser } from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { StockExitPurchaseSourcesDto } from './stock-exits.dto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class StockExitPurchasesService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}
  async canRead(u: AuthUser) {
    return (
      u.permissions.includes('purchasing.read') &&
      (await this.modules.getEnabledKeys(u.tenantId)).has('purchasing')
    );
  }
  async requireRead(u: AuthUser) {
    if (!(await this.canRead(u)))
      throw new ForbiddenException('Lecture Achats requise pour ce rapprochement.');
  }
  async context(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const r = await tx.supplierReceiptLine.findFirst({
      where: { tenantId, id },
      include: {
        orderLine: { include: { order: true } },
        supplierReceipt: { include: { receipt: true } },
        receiptLine: true,
      },
    });
    if (!r) throw new NotFoundException('Ligne de réception fournisseur introuvable.');
    const line = r.receiptLine,
      receipt = r.supplierReceipt.receipt,
      order = r.orderLine.order;
    if (
      [
        line.tenantId,
        receipt.tenantId,
        r.orderLine.tenantId,
        order.tenantId,
        r.supplierReceipt.tenantId,
      ].some((t) => t !== tenantId) ||
      r.supplierReceipt.orderId !== order.id ||
      line.receiptId !== receipt.id ||
      receipt.status !== 'POSTED' ||
      !['CONFIRMED', 'CLOSED'].includes(order.status) ||
      !line.lotId ||
      r.unitSnapshot !== r.orderLine.unitSnapshot
    )
      throw new ConflictException('La preuve de réception est incohérente ou non enregistrée.');
    // The journal is per receipt: compare all repeated lines for this exact item/lot/bin.
    const [lines, movements, allocated] = await Promise.all([
      tx.receiptLine.aggregate({
        where: {
          tenantId,
          receiptId: receipt.id,
          itemId: line.itemId,
          lotId: line.lotId,
          toBinId: line.toBinId,
        },
        _sum: { qty: true },
      }),
      tx.stockMovement.aggregate({
        where: {
          tenantId,
          refType: 'receipt',
          refId: receipt.id,
          type: 'RECEIPT',
          itemId: line.itemId,
          lotId: line.lotId,
          toBinId: line.toBinId,
          fromBinId: null,
          unitSnapshot: r.unitSnapshot,
        },
        _sum: { qty: true },
      }),
      tx.wmsStockExit.aggregate({
        where: { tenantId, purchaseSourceId: id, status: { in: ['DRAFT', 'POSTED'] } },
        _sum: { quantity: true },
      }),
    ]);
    if (!lines._sum.qty || !movements._sum.qty || !lines._sum.qty.eq(movements._sum.qty))
      throw new ConflictException('La réception ne correspond pas à son journal de stock.');
    const used = allocated._sum.quantity ?? new Prisma.Decimal(0);
    const snapshot = {
      version: 1,
      sourceId: r.id,
      orderId: order.id,
      orderNumber: order.number,
      orderLineId: r.orderLineId,
      position: r.orderLine.position,
      name: r.orderLine.nameSnapshot,
      receiptId: receipt.id,
      receiptNumber: receipt.number,
      receiptLineId: line.id,
      receivedAt: receipt.postedAt?.toISOString() ?? null,
      supplierId: order.supplierId,
      itemId: line.itemId,
      lotId: line.lotId,
      locationId: receipt.locationId,
      receivedQuantity: line.qty.toFixed(),
      unit: r.unitSnapshot,
      unitPrice: r.orderLine.unitPrice.toFixed(),
      currency: order.currency,
    };
    return {
      snapshot,
      used: used.toFixed(),
      remaining: line.qty.minus(used).toFixed(),
      token: hash(['return-source-v1', tenantId, snapshot, used.toFixed()]),
    };
  }
  async sources(u: AuthUser, q: StockExitPurchaseSourcesDto) {
    await this.requireRead(u);
    const { page, pageSize, skip, take } = paginationArgs(q);
    return this.db.$transaction(
      async (tx) => {
        const bin = await tx.bin.findFirst({
          where: { tenantId: u.tenantId, id: q.binId },
          select: { locationId: true },
        });
        if (!bin) throw new NotFoundException('Emplacement introuvable.');
        const where: Prisma.SupplierReceiptLineWhereInput = {
          tenantId: u.tenantId,
          receiptLine: { tenantId: u.tenantId, itemId: q.itemId, lotId: q.lotId },
          supplierReceipt: {
            tenantId: u.tenantId,
            order: {
              tenantId: u.tenantId,
              supplierId: q.supplierId,
              status: { in: ['CONFIRMED', 'CLOSED'] },
              ...(q.search?.trim()
                ? { number: { contains: q.search.trim().slice(0, 100), mode: 'insensitive' } }
                : {}),
            },
            receipt: { tenantId: u.tenantId, status: 'POSTED', locationId: bin.locationId },
          },
        };
        const ids = await tx.supplierReceiptLine.findMany({
          where,
          skip,
          take,
          orderBy: { id: 'desc' },
          select: {
            id: true,
            supplierReceipt: {
              select: {
                order: { select: { number: true } },
                receipt: { select: { number: true } },
              },
            },
          },
        });
        const rows: { id: string; name: string; token: string | null; remaining: string | null }[] =
          [];
        for (const { id, supplierReceipt } of ids) {
          try {
            const c = await this.context(tx, u.tenantId, id);
            rows.push({
              id,
              name: `${c.snapshot.orderNumber} · ligne ${c.snapshot.position + 1} · ${c.snapshot.receiptNumber} · ${c.remaining} ${c.snapshot.unit} à rattacher`,
              token: c.token,
              remaining: c.remaining,
            });
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            // A legacy/incomplete journal must not hide other valid receipts on this page.
            rows.push({
              id,
              name: `${supplierReceipt.order.number} · ${supplierReceipt.receipt.number} · preuve incomplète — rapprochement indisponible`,
              token: null,
              remaining: null,
            });
          }
        }
        return paginated(rows, await tx.supplierReceiptLine.count({ where }), page, pageSize);
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
  async capture(
    tx: Prisma.TransactionClient,
    u: AuthUser,
    d: {
      kind: string;
      purchaseSourceId?: string;
      purchaseSourceToken?: string;
      itemId: string;
      lotId: string;
      supplierId?: string;
      quantity: string;
    },
    locationId: string,
    unit: string,
  ) {
    if (!d.purchaseSourceId) {
      if (d.purchaseSourceToken) throw new BadRequestException('Ligne d’achat manquante.');
      return null;
    }
    await this.requireRead(u);
    if (d.kind !== 'SUPPLIER_RETURN' || !d.purchaseSourceToken)
      throw new BadRequestException(
        'Rapprochement réservé aux retours fournisseur avec sélection revue.',
      );
    const c = await this.context(tx, u.tenantId, d.purchaseSourceId),
      s = c.snapshot;
    if (
      s.supplierId !== d.supplierId ||
      s.itemId !== d.itemId ||
      s.lotId !== d.lotId ||
      s.locationId !== locationId ||
      s.unit !== unit
    )
      throw new ConflictException(
        'Fournisseur, article, lot, site et unité doivent correspondre à la réception.',
      );
    if (c.token !== d.purchaseSourceToken)
      throw new ConflictException(
        'La quantité déjà rattachée a changé. Sélectionnez à nouveau la réception.',
      );
    if (new Prisma.Decimal(d.quantity).gt(c.remaining))
      throw new ConflictException(
        'Quantité supérieure au reste de cette réception à rattacher. Les brouillons comptent aussi.',
      );
    return s;
  }
  async verify(tx: Prisma.TransactionClient, u: AuthUser, d: WmsStockExit) {
    if (!d.purchaseSourceId) return null;
    await this.requireRead(u);
    const c = await this.context(tx, u.tenantId, d.purchaseSourceId);
    if (
      !isDeepStrictEqual(c.snapshot, d.purchaseSnapshot) ||
      new Prisma.Decimal(c.used).gt(c.snapshot.receivedQuantity)
    )
      throw new ConflictException('La preuve d’achat ou son cumul de retours ne correspond plus.');
    return c.token;
  }
  async view(u: AuthUser, id: string) {
    // No hidden counters or identifiers when purchase access is absent.
    if (!(await this.canRead(u))) return { available: false };
    const d = await this.db.wmsStockExit.findFirst({
      where: { tenantId: u.tenantId, id },
      select: { purchaseSnapshot: true },
    });
    if (!d) throw new NotFoundException('Dossier de sortie introuvable.');
    return { available: true, snapshot: d.purchaseSnapshot };
  }
}
