import { normalizeDeliveryPackageQuantity } from './packages';

/** Exact base-unit quantities. No floating point, conversion, or cross-unit addition. */
export function deliveryAllocationMilli(value: string): bigint {
  const canonical = value === '0' ? value : normalizeDeliveryPackageQuantity(value);
  const [whole, fraction = ''] = canonical.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function deliveryAllocationDecimal(value: bigint): string {
  if (value < 0n) throw new Error('Quantité négative interdite.');
  const fraction = String(value % 1000n)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${value / 1000n}${fraction ? `.${fraction}` : ''}`;
}
export interface AllocationQuantityRow {
  quantity: string;
  unit: string;
  packageStatus: string;
  released: boolean;
}
/** Released links are history; RETURNED remains allocated, but is not delivered net. */
export function deriveDeliveryAllocationQuantities(
  sourceQuantity: string,
  unit: string,
  rows: readonly AllocationQuantityRow[],
) {
  const source = deliveryAllocationMilli(sourceQuantity);
  let allocated = 0n,
    delivered = 0n,
    returned = 0n;
  for (const row of rows) {
    if (row.released) continue;
    if (row.unit !== unit) throw new Error('Unités différentes : aucune conversion implicite.');
    if (!['PREPARED', 'LOADED', 'DELIVERED', 'RETURNED', 'CANCELLED'].includes(row.packageStatus))
      throw new Error('Statut colis inconnu.');
    const quantity = deliveryAllocationMilli(row.quantity);
    allocated += quantity;
    if (row.packageStatus === 'DELIVERED') delivered += quantity;
    if (row.packageStatus === 'RETURNED') returned += quantity;
  }
  if (allocated > source) throw new Error('La quantité attribuée dépasse la source.');
  return {
    allocated: deliveryAllocationDecimal(allocated),
    delivered: deliveryAllocationDecimal(delivered),
    returned: deliveryAllocationDecimal(returned),
    remainingToAllocate: deliveryAllocationDecimal(source - allocated),
    remainingToDeliver: deliveryAllocationDecimal(source - delivered),
  };
}

export interface DeliveryAllocationSourceRow {
  id: string;
  kind: 'sales' | 'pick';
  name: string;
  documentNumber: string;
  siteId: string | null;
  siteName: string | null;
  quantity: string;
  /** CRM has no intrinsic unit: null until a human captures the 1:1 attestation. */
  unit: string | null;
  updatedAt: string;
  orderUpdatedAt?: string;
  status: string;
  selectable: boolean;
  totals: ReturnType<typeof deriveDeliveryAllocationQuantities> | null;
}
export interface DeliveryAllocationView {
  id: string;
  packageId: string;
  contentIndex: number;
  quantity: string;
  unit: string;
  sourceSalesOrderLineId: string | null;
  sourcePickLineId: string | null;
  salesLabel: string | null;
  pickLabel: string | null;
  createdAt: string;
  releasedAt: string | null;
  canRelease: boolean;
}
export interface DeliveryAllocationWorkspace {
  shipment: { id: string; shipmentNumber: string; status: string; updatedAt: string };
  access: { sales: boolean; picking: boolean };
  salesLines: DeliveryAllocationSourceRow[];
  pickLines: DeliveryAllocationSourceRow[];
  allocations: DeliveryAllocationView[];
  packages: {
    id: string;
    code: string;
    status: string;
    version: number;
    canAllocate: boolean;
    contents: { reference: string; description: string; quantity: string; unit: string }[];
    lockedContentIndices: number[];
  }[];
}
