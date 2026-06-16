export enum StockMovementType {
  RECEIPT = 'RECEIPT',
  MOVE = 'MOVE',
  PICK = 'PICK',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum BinKind {
  RECEIVING = 'RECEIVING',
  STORAGE = 'STORAGE',
  SHIPPING = 'SHIPPING',
}

export enum ReceiptStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}

export enum PickOrderStatus {
  OPEN = 'OPEN',
  PICKED = 'PICKED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

const RECEIPT_TRANSITIONS: Record<ReceiptStatus, ReceiptStatus[]> = {
  [ReceiptStatus.DRAFT]: [ReceiptStatus.POSTED, ReceiptStatus.CANCELLED],
  [ReceiptStatus.POSTED]: [],
  [ReceiptStatus.CANCELLED]: [],
};

export function canTransitionReceipt(from: ReceiptStatus, to: ReceiptStatus): boolean {
  if (from === to) return true;
  return RECEIPT_TRANSITIONS[from]?.includes(to) ?? false;
}

const PICK_TRANSITIONS: Record<PickOrderStatus, PickOrderStatus[]> = {
  [PickOrderStatus.OPEN]: [PickOrderStatus.PICKED, PickOrderStatus.COMPLETED, PickOrderStatus.CANCELLED],
  [PickOrderStatus.PICKED]: [PickOrderStatus.COMPLETED, PickOrderStatus.CANCELLED],
  [PickOrderStatus.COMPLETED]: [],
  [PickOrderStatus.CANCELLED]: [],
};

export function canTransitionPickOrder(from: PickOrderStatus, to: PickOrderStatus): boolean {
  if (from === to) return true;
  return PICK_TRANSITIONS[from]?.includes(to) ?? false;
}

export type BalanceResult = { ok: true; next: number } | { ok: false; reason: 'NEGATIVE' };

export function applyToBalance(current: number, delta: number, opts?: { allowNegative?: boolean }): BalanceResult {
  const next = current + delta;
  if (next < 0 && !opts?.allowNegative) return { ok: false, reason: 'NEGATIVE' };
  return { ok: true, next };
}

export type ShipmentPickStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED';

/**
 * Derives a shipment's warehouse-preparation state from its linked pick orders.
 * ≥1 COMPLETED -> PICKED; else ≥1 non-terminal (OPEN/PICKED) -> PICKING; else NOT_PICKED.
 */
export function deriveShipmentPickStatus(pickOrderStatuses: PickOrderStatus[]): ShipmentPickStatus {
  if (pickOrderStatuses.some((s) => s === PickOrderStatus.COMPLETED)) return 'PICKED';
  if (pickOrderStatuses.some((s) => s === PickOrderStatus.OPEN || s === PickOrderStatus.PICKED)) return 'PICKING';
  return 'NOT_PICKED';
}
