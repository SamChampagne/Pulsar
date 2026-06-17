/**
 * Min/max replenishment status (pure). On-hand at/below the reorder point flags
 * BELOW_MIN with a suggested quantity to restock back up to `reorderQty` (the
 * target level); just above is LOW (early warning). Computed on read — never
 * persisted. `reorderPoint`/`reorderQty` live on WmsItem.
 */
export type ReplenishmentStatus = 'OK' | 'LOW' | 'BELOW_MIN';

export interface ReplenishmentInput {
  onHand: number;
  reorderPoint?: number | null;
  /** Target stock level to restock up to. Falls back to reorderPoint if unset. */
  reorderQty?: number | null;
}

export interface ReplenishmentResult {
  status: ReplenishmentStatus;
  belowMin: boolean;
  suggestedQty: number;
}

export function computeReplenishment(input: ReplenishmentInput): ReplenishmentResult {
  const rp = input.reorderPoint;
  if (rp == null || rp < 0) return { status: 'OK', belowMin: false, suggestedQty: 0 };

  if (input.onHand <= rp) {
    const target = input.reorderQty ?? rp;
    const suggestedQty = Math.max(0, Math.ceil(target - input.onHand));
    return { status: 'BELOW_MIN', belowMin: true, suggestedQty };
  }
  if (input.onHand <= rp * 1.2) return { status: 'LOW', belowMin: false, suggestedQty: 0 };
  return { status: 'OK', belowMin: false, suggestedQty: 0 };
}
