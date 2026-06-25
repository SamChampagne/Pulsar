// Pure, browser-safe. No Node imports.
export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  FULFILLED = 'FULFILLED',
  INVOICED = 'INVOICED',
  CANCELLED = 'CANCELLED',
}

const TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  [SalesOrderStatus.DRAFT]: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.CONFIRMED]: [SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.FULFILLED]: [SalesOrderStatus.INVOICED],
  [SalesOrderStatus.INVOICED]: [],
  [SalesOrderStatus.CANCELLED]: [],
};

export function canTransitionSalesOrder(from: SalesOrderStatus, to: SalesOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = not in a terminal state (INVOICED/CANCELLED). */
export function isSalesOrderOpen(s: SalesOrderStatus): boolean {
  return s !== SalesOrderStatus.INVOICED && s !== SalesOrderStatus.CANCELLED;
}
