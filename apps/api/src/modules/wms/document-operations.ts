import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { IsDateString, IsOptional } from 'class-validator';
import { materialReceiptContext } from './receiving/material-purchase-receipt';

export type WmsDocumentKind = 'receipt' | 'pickOrder';
export class WmsVersionDto {
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
const itemSelect = { sku: true, name: true, unit: true, isActive: true, lotTracked: true } as const;
const lotSelect = {
  disposition: true,
  dispositionReason: true,
  id: true,
  code: true,
  expiresOn: true,
  manufacturedOn: true,
  supplierLot: true,
} as const;
const binSelect = { id: true, code: true, zone: true, isActive: true, locationId: true } as const;
const locationSelect = { id: true, code: true, name: true, type: true } as const;

/** All document writers take the stock mutex FIRST, then reload their document/lines. */
export async function lockWmsDocument(
  db: Prisma.TransactionClient,
  tenantId: string,
  kind: WmsDocumentKind,
  id: string,
  expected?: string,
) {
  await db.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  const doc =
    kind === 'receipt'
      ? await db.receipt.findFirst({ where: { tenantId, id } })
      : await db.pickOrder.findFirst({ where: { tenantId, id } });
  if (!doc) throw new NotFoundException('Document entrepôt introuvable.');
  if (expected && doc.updatedAt.toISOString() !== new Date(expected).toISOString())
    throw new ConflictException('Ce document a changé. Actualisez-le avant de confirmer.');
  return doc;
}

/** Millisecond-monotonic version, including two line edits in the same clock tick. */
export function nextWmsVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export async function assertWmsLine(
  db: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  itemId: string,
  binId: string,
  qty: number,
) {
  if (!Number.isFinite(qty) || qty <= 0 || new Prisma.Decimal(qty).decimalPlaces() > 3)
    throw new BadRequestException('Quantité positive requise, avec au plus trois décimales.');
  const [item, bin, site] = await Promise.all([
    db.wmsItem.findFirst({ where: { tenantId, id: itemId }, select: { isActive: true } }),
    db.bin.findFirst({
      where: { tenantId, id: binId },
      select: { isActive: true, locationId: true },
    }),
    db.location.findFirst({
      where: { tenantId, id: locationId, type: 'WAREHOUSE' },
      select: { id: true },
    }),
  ]);
  if (!site) throw new BadRequestException('Le site doit être un entrepôt.');
  if (!item || !bin)
    throw new BadRequestException('Article ou emplacement introuvable dans cette entreprise.');
  if (!item.isActive || !bin.isActive)
    throw new ConflictException('Article ou emplacement inactif.');
  if (bin.locationId !== locationId)
    throw new BadRequestException('L’emplacement doit appartenir à l’entrepôt du document.');
}

/** Read-only, no reservation: combine repeated item/bin lines before comparing stock. */
export async function readWmsDocument(
  db: Prisma.TransactionClient,
  tenantId: string,
  kind: WmsDocumentKind,
  id: string,
) {
  const doc =
    kind === 'receipt'
      ? await db.receipt.findFirst({
          where: { tenantId, id },
          include: {
            location: { select: locationSelect },
            lines: {
              orderBy: { id: 'asc' },
              include: {
                item: { select: itemSelect },
                toBin: { select: binSelect },
                lot: { select: lotSelect },
              },
            },
          },
        })
      : await db.pickOrder.findFirst({
          where: { tenantId, id },
          include: {
            location: { select: locationSelect },
            lines: {
              orderBy: { id: 'asc' },
              include: {
                item: { select: itemSelect },
                fromBin: { select: binSelect },
                lot: { select: lotSelect },
              },
            },
            shipment: { select: { id: true, shipmentNumber: true, status: true } },
          },
        });
  if (!doc) throw new NotFoundException('Document entrepôt introuvable.');
  const applicable =
    kind === 'receipt' ? doc.status === 'DRAFT' : ['OPEN', 'PICKED'].includes(doc.status);
  const rows = doc.lines.map((line) => ({
    ...line,
    bin: 'toBin' in line ? line.toBin : line.fromBin,
  }));
  const key = (itemId: string, binId: string, lotId?: string | null) =>
    JSON.stringify([itemId, binId, lotId ?? null]);
  const demand = new Map<string, Prisma.Decimal>();
  for (const line of rows) {
    const k = key(line.itemId, line.bin.id, line.lotId);
    demand.set(k, (demand.get(k) ?? new Prisma.Decimal(0)).plus(line.qty));
  }
  const levels =
    kind === 'pickOrder' && applicable
      ? await db.inventoryLevel.findMany({
          where: {
            tenantId,
            itemId: { in: rows.map((l) => l.itemId) },
            binId: { in: rows.map((l) => l.bin.id) },
          },
          select: { itemId: true, binId: true, qtyOnHand: true },
        })
      : [];
  const stock = new Map(levels.map((l) => [key(l.itemId, l.binId), l.qtyOnHand]));
  if (kind === 'pickOrder' && applicable) {
    const lots = await db.wmsLotBalance.findMany({
      where: {
        tenantId,
        lotId: { in: rows.flatMap((l) => (l.lotId ? [l.lotId] : [])) },
        binId: { in: rows.map((l) => l.bin.id) },
      },
    });
    for (const l of lots) stock.set(key(l.itemId, l.binId, l.lotId), l.qtyOnHand);
  }
  const checks = rows.map((line) => {
    const issues: string[] = [];
    const required = demand.get(key(line.itemId, line.bin.id, line.lotId))!;
    const onHand = stock.get(key(line.itemId, line.bin.id, line.lotId)) ?? new Prisma.Decimal(0);
    if (applicable) {
      if (doc.location.type !== 'WAREHOUSE') issues.push('Site non configuré comme entrepôt');
      if (!line.item.isActive) issues.push('Article inactif');
      if (line.item.lotTracked && !line.lot) issues.push('Choisissez le lot de cette ligne');
      if (!line.item.lotTracked && line.lot) issues.push('Article non suivi par lot');
      if (kind === 'pickOrder' && line.lot?.disposition === 'QUARANTINED')
        issues.push(`Lot en quarantaine : ${line.lot.dispositionReason ?? 'sortie interdite'}`);
      if (!line.bin.isActive) issues.push('Emplacement inactif');
      if (line.bin.locationId !== doc.locationId) issues.push('Emplacement d’un autre site');
      if (line.qty.lte(0)) issues.push('Quantité non positive');
      if (kind === 'pickOrder' && onHand.lt(required))
        issues.push('Stock insuffisant pour les lignes de ce dossier');
    }
    return {
      lineId: line.id,
      issues,
      requiredFromBin: required.toString(),
      stockOnHand: kind === 'pickOrder' && applicable ? onHand.toString() : null,
      shortage:
        kind === 'pickOrder' && applicable
          ? Prisma.Decimal.max(0, required.minus(onHand)).toString()
          : null,
    };
  });
  const materialPurchase =
    kind === 'receipt' ? await materialReceiptContext(db, tenantId, doc, doc.lines) : null;
  if (applicable && materialPurchase?.issues.length) {
    for (const check of checks) check.issues.push(...materialPurchase.issues);
  }
  return {
    ...doc,
    ...(kind === 'receipt' ? { materialPurchase } : {}),
    readiness: {
      generatedAt: new Date().toISOString(),
      applicable,
      canExecute: applicable && rows.length > 0 && checks.every((c) => c.issues.length === 0),
      blockedLines: checks.filter((c) => c.issues.length).length,
      lines: checks,
    },
  };
}
