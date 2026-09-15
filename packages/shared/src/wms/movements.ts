export const WMS_MOVEMENT_LABELS: Record<string, string> = {
  RECEIPT: 'Réception',
  MOVE: 'Déplacement',
  PICK: 'Prélèvement',
  ADJUSTMENT: 'Ajustement',
};
export interface WmsMovementRow {
  id: string;
  type: string;
  createdAt: string;
  item: { id: string; sku: string; name: string };
  qty: string;
  unit: string;
  unitCaptured: boolean;
  fromBin: WmsMovementBin | null;
  toBin: WmsMovementBin | null;
  note: string | null;
  actor: string | null;
  source: { kind: 'receipt' | 'pick-order' | 'cycle-count'; id: string; number: string } | null;
}
export interface WmsMovementBin {
  id: string;
  code: string;
  locationId: string;
  locationName: string;
}
export interface WmsMoveResult {
  movementId: string;
  createdAt: string;
  replayed: boolean;
}
export interface WmsMoveRequest {
  operationKey: string;
  itemId: string;
  fromBinId: string;
  toBinId: string;
  qty: number;
  note?: string;
  locationId?: string;
}
export interface WmsPutawayRow {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  isActive: boolean;
  binId: string;
  binCode: string;
  zone: string | null;
  binActive: boolean;
  locationId: string;
  qtyOnHand: string;
}
