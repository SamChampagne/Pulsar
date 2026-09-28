import { ConflictException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { StockMovementType } from '@pulsar/shared';
/** No generic "ignore quarantine" flag: only a matching, open, versioned exit dossier. */
export async function stockExitMovementGate(
  tx: Prisma.TransactionClient,
  a: {
    tenantId: string;
    userId?: string;
    type: StockMovementType;
    itemId: string;
    lotId?: string | null;
    fromBinId?: string;
    toBinId?: string;
    qty: number;
    refType?: string;
    refId?: string;
  },
  unit: string,
) {
  const exit =
    a.type === StockMovementType.DISPOSAL || a.type === StockMovementType.SUPPLIER_RETURN;
  if (!exit && a.refType !== 'stock-exit') return false;
  if (
    !exit ||
    a.refType !== 'stock-exit' ||
    !a.refId ||
    !a.userId ||
    !a.fromBinId ||
    a.toBinId ||
    !a.lotId
  )
    throw new ConflictException('Une sortie documentée valide est obligatoire.');
  const d = await tx.wmsStockExit.findFirst({
    where: {
      tenantId: a.tenantId,
      id: a.refId,
      status: 'DRAFT',
      kind: a.type === StockMovementType.DISPOSAL ? 'DISPOSAL' : 'SUPPLIER_RETURN',
      itemId: a.itemId,
      lotId: a.lotId,
      binId: a.fromBinId,
    },
  });
  if (
    !d ||
    !d.quantity.eq(a.qty) ||
    d.unitSnapshot !== unit ||
    (await tx.stockMovement.count({
      where: { tenantId: a.tenantId, refType: 'stock-exit', refId: a.refId },
    }))
  )
    throw new ConflictException('Sortie incohérente, déjà exécutée ou unité modifiée.');
  return true;
}
