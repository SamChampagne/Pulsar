export type MaterialSupplier = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  terms: string | null;
  isActive: boolean;
  updatedAt: string;
};
export type MaterialRequest = {
  id: string;
  number: string;
  runId: string;
  proposalId: string;
  itemId: string;
  locationId: string;
  quantity: string;
  unitSnapshot: string;
  dueDate: string;
  status: string;
  updatedAt: string;
  item: { sku: string; name: string };
  location: { name: string; code: string };
  purchaseOrder: { id: string; number: string; status: string } | null;
};
export type MaterialPurchase = {
  id: string;
  number: string;
  status: string;
  preparation: MaterialRequest;
  supplierId: string;
  supplier: { code: string; name: string; email: string | null };
  unitPrice: string;
  currency: string;
  subtotal: string;
  terms: string | null;
  expectedDate: string;
  supplierReference: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  received: string;
  remaining: string;
  fulfillment: string;
  receipts: {
    id: string;
    number: string;
    status: string;
    quantity: string;
    postedAt: string | null;
  }[];
};
export const purchaseLabel = (status: string) =>
  ({ DRAFT: 'Brouillon', CONFIRMED: 'Commandé', CANCELLED: 'Annulé', POSTED: 'Stock reçu' })[
    status
  ] ?? status;
