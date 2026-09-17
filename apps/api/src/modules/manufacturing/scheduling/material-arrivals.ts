import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';

/** Operational supply only. No price/contact/CRM projections. One site, exact quantities. */
export async function materialArrivals(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
) {
  const purchases = await tx.materialPurchaseOrder.findMany({
    where: {
      tenantId,
      status: 'CONFIRMED',
      closedAt: null,
      preparation: { tenantId, locationId, status: 'DRAFT' },
    },
    include: {
      preparation: { include: { item: true } },
      receipts: {
        where: { tenantId },
        include: { receipt: { include: { lines: { where: { tenantId } } } } },
      },
    },
    orderBy: [{ expectedDate: 'asc' }, { id: 'asc' }],
    take: 10001,
  });
  if (purchases.length > 10000) throw new BadRequestException('Maximum 10 000 arrivages par site.');
  return purchases.flatMap((p) => {
    const received = p.receipts
      .filter((r) => r.receipt.status === 'POSTED')
      .flatMap((r) => r.receipt.lines)
      .filter((l) => l.itemId === p.preparation.itemId)
      .reduce((n, l) => n.plus(l.qty), new Prisma.Decimal(0));
    const remaining = Prisma.Decimal.max(
      0,
      p.preparation.quantity.minus(received).minus(p.closedQuantity),
    );
    if (remaining.isZero()) return [];
    if (!p.preparation.item.isActive || p.preparation.item.unit !== p.preparation.unitSnapshot)
      throw new BadRequestException(`Article/unité incompatible : ${p.number}.`);
    return [
      {
        id: p.id,
        preparationId: p.preparationId,
        number: p.number,
        itemId: p.preparation.itemId,
        sku: p.preparation.item.sku,
        unit: p.preparation.unitSnapshot,
        quantity: remaining.toFixed(),
        expectedDate: p.expectedDate.toISOString().slice(0, 10),
      },
    ];
  });
}
