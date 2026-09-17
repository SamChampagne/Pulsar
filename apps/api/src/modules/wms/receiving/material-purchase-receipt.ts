import { ConflictException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';

/** Shared read/write check. Writers hold the WMS tenant mutex. No prices/CRM data. */
export async function materialReceiptContext(
  tx: Prisma.TransactionClient,
  tenantId: string,
  receipt: { id: string; locationId: string; status: string },
  lines: { itemId: string; qty: Prisma.Decimal }[],
) {
  const link = await tx.materialPurchaseReceipt.findFirst({
    where: { tenantId, receiptId: receipt.id },
    include: {
      purchaseOrder: { include: { preparation: { include: { item: true, location: true } } } },
    },
  });
  if (!link) return null;
  const order = link.purchaseOrder,
    prep = order.preparation;
  const received = await tx.receiptLine.aggregate({
    where: {
      tenantId,
      itemId: prep.itemId,
      receipt: {
        tenantId,
        status: 'POSTED',
        materialPurchaseReceipt: { tenantId, purchaseOrderId: order.id },
      },
    },
    _sum: { qty: true },
  });
  const total = received._sum.qty ?? new Prisma.Decimal(0);
  const remaining = Prisma.Decimal.max(0, prep.quantity.minus(total).minus(order.closedQuantity));
  const issues: string[] = [];
  if (receipt.status === 'DRAFT') {
    if (
      !(await tx.tenantModule.count({
        where: { tenantId, enabled: true, module: { key: 'manufacturing' } },
      }))
    )
      issues.push('Le module Fabrication doit être actif pour réceptionner cette commande.');
    if (
      order.tenantId !== tenantId ||
      prep.tenantId !== tenantId ||
      order.status !== 'CONFIRMED' ||
      order.closedAt ||
      prep.status !== 'DRAFT'
    )
      issues.push('La commande matières doit être confirmée et sa demande active.');
    if (
      prep.locationId !== receipt.locationId ||
      prep.item.tenantId !== tenantId ||
      prep.item.unit !== prep.unitSnapshot ||
      !prep.location.isActive ||
      lines.some((l) => l.itemId !== prep.itemId)
    )
      issues.push('Article, unité ou entrepôt incompatible avec la commande matières.');
    if (lines.reduce((sum, l) => sum.plus(l.qty), new Prisma.Decimal(0)).gt(remaining))
      issues.push(
        `Sur-réception refusée : reste ${remaining.toFixed()} ${prep.unitSnapshot} sur la commande.`,
      );
  }
  return {
    purchaseOrderId: order.id,
    preparationId: prep.id,
    number: order.number,
    ordered: prep.quantity.toFixed(),
    received: total.toFixed(),
    remaining: remaining.toFixed(),
    unit: prep.unitSnapshot,
    issues,
  };
}

export async function assertMaterialReceipt(...args: Parameters<typeof materialReceiptContext>) {
  const context = await materialReceiptContext(...args);
  if (context?.issues.length) throw new ConflictException(context.issues.join(' '));
  return context;
}
