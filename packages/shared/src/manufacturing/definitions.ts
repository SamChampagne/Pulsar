/** Inclusive date-only validity; legacy revisions may remain unbounded. */
export function coversManufacturingPeriod(
  revision: { validFrom?: string | null; validUntil?: string | null },
  from: string,
  until: string,
): boolean {
  return (
    from <= until &&
    (!revision.validFrom || revision.validFrom.slice(0, 10) <= from) &&
    (!revision.validUntil || revision.validUntil.slice(0, 10) >= until)
  );
}

export enum MrpPreparationStatus {
  DRAFT = 'DRAFT',
  CANCELLED = 'CANCELLED',
}
export function canTransitionMrpPreparation(from: MrpPreparationStatus, to: MrpPreparationStatus) {
  return from === MrpPreparationStatus.DRAFT && to === MrpPreparationStatus.CANCELLED;
}

/** Captured stock units, no implicit conversion or density assumptions. */
export interface ManufacturingMaterialSnapshot {
  version: 'pulsar.manufacturing.materials.v1';
  revisionId: string;
  revision: number;
  contentHash: string;
  locationId: string;
  capturedAt: string;
  product: { itemId: string; sku: string; name: string; unit: string; quantity: string };
  components: {
    itemId: string;
    sku: string;
    name: string;
    unit: string;
    quantityPerUnit: string;
    requiredQuantity: string;
  }[];
}
