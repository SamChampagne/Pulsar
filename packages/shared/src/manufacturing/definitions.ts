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
