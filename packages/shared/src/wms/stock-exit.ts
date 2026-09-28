export enum StockExitKind {
  DISPOSAL = 'DISPOSAL',
  SUPPLIER_RETURN = 'SUPPLIER_RETURN',
}
export enum StockExitStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}
export function canTransitionStockExit(from: StockExitStatus, to: StockExitStatus): boolean {
  return (
    from === StockExitStatus.DRAFT &&
    (to === StockExitStatus.POSTED || to === StockExitStatus.CANCELLED)
  );
}
export const STOCK_EXIT_LABELS: Record<StockExitKind, string> = {
  DISPOSAL: 'Destruction / rebut',
  SUPPLIER_RETURN: 'Retour fournisseur',
};
export interface StockExitView {
  id: string;
  number: string;
  kind: StockExitKind;
  status: StockExitStatus;
  itemId: string;
  lotId: string;
  binId: string;
  quantity: string;
  unitSnapshot: string;
  reason: string;
  supplierId: string | null;
  reference: string | null;
  destination: string | null;
  snapshot: {
    item: { sku: string; name: string };
    lot: { code: string };
    bin: { code: string; locationId: string; locationName: string };
    supplier: { id: string; code: string; name: string; updatedAt: string } | null;
  };
  completionNote: string | null;
  cancellationReason: string | null;
  movementId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdBy: { firstName: string; lastName: string };
  closedBy: { firstName: string; lastName: string } | null;
}
export interface StockExitReview {
  expectedUpdatedAt: string;
  reviewToken: string;
  blockedReasons: string[];
  quantity: string;
  onHand: string;
  remaining: string;
  unit: string;
  disposition: string;
  dispositionRevision: number;
  movementCount: number;
}
