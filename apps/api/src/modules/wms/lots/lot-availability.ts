import { Prisma } from '@pulsar/database';

/** Physical stock is unchanged. Only usable availability excludes quarantined lots. */
export async function quarantinedByItem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  itemIds?: string[],
) {
  const rows = await tx.wmsLotBalance.groupBy({
    by: ['itemId'],
    where: {
      tenantId,
      ...(itemIds ? { itemId: { in: itemIds } } : {}),
      bin: { tenantId, locationId, isActive: true },
      lot: { tenantId, disposition: 'QUARANTINED' },
    },
    _sum: { qtyOnHand: true },
  });
  return new Map(rows.map((r) => [r.itemId, r._sum.qtyOnHand ?? new Prisma.Decimal(0)]));
}

export function availableAfterQuarantine(physical: Prisma.Decimal, held?: Prisma.Decimal) {
  return Prisma.Decimal.max(0, physical.minus(held ?? 0));
}

export async function withLotAvailability<
  T extends { itemId: string; binId: string; qtyOnHand: Prisma.Decimal },
>(tx: Prisma.TransactionClient, tenantId: string, rows: T[]) {
  if (!rows.length) return [];
  const held = await tx.wmsLotBalance.groupBy({
    by: ['itemId', 'binId'],
    where: {
      tenantId,
      lot: { tenantId, disposition: 'QUARANTINED' },
      OR: rows.map((r) => ({ itemId: r.itemId, binId: r.binId })),
    },
    _sum: { qtyOnHand: true },
  });
  const key = (item: string, bin: string) => JSON.stringify([item, bin]);
  const byBin = new Map(
    held.map((r) => [key(r.itemId, r.binId), r._sum.qtyOnHand ?? new Prisma.Decimal(0)]),
  );
  return rows.map((r) => ({
    ...r,
    quarantinedQty: (byBin.get(key(r.itemId, r.binId)) ?? new Prisma.Decimal(0)).toFixed(),
    availableQty: availableAfterQuarantine(
      r.qtyOnHand,
      byBin.get(key(r.itemId, r.binId)),
    ).toFixed(),
  }));
}
