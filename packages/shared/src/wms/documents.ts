/** Browser-safe read contract for the guided WMS document screens. */
export interface WmsLineCheck {
  lineId: string;
  issues: string[];
  requiredFromBin: string;
  stockOnHand: string | null;
  shortage: string | null;
}
export interface WmsDocumentReadiness {
  generatedAt: string;
  applicable: boolean;
  canExecute: boolean;
  blockedLines: number;
  lines: WmsLineCheck[];
}
export interface WmsDocumentBin {
  id: string;
  code: string;
  zone: string | null;
  isActive: boolean;
  locationId: string;
}
export interface WmsDocumentLine {
  lotId?: string | null;
  lot?: {
    id: string;
    code: string;
    expiresOn: string | null;
    manufacturedOn: string | null;
    supplierLot: string | null;
  } | null;
  id: string;
  itemId: string;
  qty: string;
  item: { sku: string; name: string; unit: string; isActive: boolean };
  toBinId?: string;
  fromBinId?: string;
  toBin?: WmsDocumentBin;
  fromBin?: WmsDocumentBin;
}
export interface WmsGuidedDocument {
  materialPurchase?: {
    purchaseOrderId: string;
    preparationId: string;
    number: string;
    ordered: string;
    received: string;
    remaining: string;
    unit: string;
    issues: string[];
  } | null;
  id: string;
  number: string;
  status: string;
  locationId: string;
  location: { id: string; code: string; name: string; type: string };
  reference: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt?: string | null;
  completedAt?: string | null;
  shipment?: { id: string; shipmentNumber: string; status: string } | null;
  lines: WmsDocumentLine[];
  readiness: WmsDocumentReadiness;
}
